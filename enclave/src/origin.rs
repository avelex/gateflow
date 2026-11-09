//! Origin-chain sender resolvers and the all-senders rule.

use serde_json::Value;

/// Public JSON-RPC endpoint of each supported EVM origin chain (1Click `blockchain` name).
pub fn evm_rpc(chain: &str) -> Option<&'static str> {
    match chain {
        "base" => Some("https://base-rpc.publicnode.com"),
        "eth" => Some("https://ethereum-rpc.publicnode.com"),
        "arb" => Some("https://arbitrum-one-rpc.publicnode.com"),
        _ => None,
    }
}

/// JSON-RPC body for `eth_getTransactionByHash`.
pub fn evm_tx_body(hash: &str) -> String {
    serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionByHash", "params": [hash]}).to_string()
}

/// `result.from` of an `eth_getTransactionByHash` reply, lowercased.
pub fn evm_sender(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    Some(v.get("result")?.get("from")?.as_str()?.to_ascii_lowercase())
}

pub fn esplora_url(hash: &str) -> String {
    format!("https://blockstream.info/api/tx/{hash}")
}

/// Every input address of an Esplora tx; `None` if any input has none (coinbase, non-standard script).
pub fn btc_senders(body: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(body).ok()?;
    let senders = v
        .get("vin")?
        .as_array()?
        .iter()
        .map(|vin| Some(vin.get("prevout")?.get("scriptpubkey_address")?.as_str()?.to_string()))
        .collect::<Option<Vec<_>>>()?;
    (!senders.is_empty()).then_some(senders)
}

pub fn blockchair_url(hash: &str) -> String {
    format!("https://api.blockchair.com/zcash/dashboards/transaction/{hash}")
}

/// Transparent input addresses of a Blockchair Zcash tx; `None` when there are none (shielded).
pub fn zec_senders(body: &str, hash: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(body).ok()?;
    let senders = v
        .get("data")?
        .get(hash)?
        .get("inputs")?
        .as_array()?
        .iter()
        .map(|input| input.get("recipient")?.as_str().filter(|r| !r.is_empty()).map(str::to_string))
        .collect::<Option<Vec<_>>>()?;
    (!senders.is_empty()).then_some(senders)
}

/// Public JSON-RPC endpoint for Solana origins.
pub const SOL_RPC: &str = "https://solana-rpc.publicnode.com";

/// JSON-RPC body for `getTransaction`; `confirmed` so a deposit 1Click already credited is found.
pub fn sol_tx_body(sig: &str) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "confirmed"}]
    })
    .to_string()
}

/// Every signer account of a `jsonParsed` Solana tx, in key order; `None` for a missing tx or no signer.
pub fn sol_senders(body: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(body).ok()?;
    let keys = v.get("result")?.get("transaction")?.get("message")?.get("accountKeys")?.as_array()?;
    let signers: Vec<String> = keys
        .iter()
        .filter(|k| k.get("signer").and_then(Value::as_bool) == Some(true))
        .map(|k| Some(k.get("pubkey")?.as_str()?.to_string()))
        .collect::<Option<_>>()?;
    (!signers.is_empty()).then_some(signers)
}

/// True only for a non-empty list in which every score is known and at most `max_risk`.
pub fn all_pass(scores: &[Option<u8>], max_risk: u8) -> bool {
    !scores.is_empty() && scores.iter().all(|s| s.is_some_and(|s| s <= max_risk))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;

    #[test]
    fn evm_rpc_map() {
        assert_eq!(evm_rpc("base"), Some("https://base-rpc.publicnode.com"));
        assert_eq!(evm_rpc("eth"), Some("https://ethereum-rpc.publicnode.com"));
        assert_eq!(evm_rpc("arb"), Some("https://arbitrum-one-rpc.publicnode.com"));
        assert_eq!(evm_rpc("polygon"), None);
    }

    #[test]
    fn evm_body() {
        let v: Value = serde_json::from_str(&evm_tx_body("0xab")).unwrap();
        assert_eq!(v, serde_json::json!({"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0xab"]}));
    }

    #[test]
    fn evm_from() {
        assert_eq!(evm_sender(&fixture("evm-tx.json")).as_deref(), Some("0xaec29d0ce4995a3e3dec32b01ca018305eb485d4"));
        assert_eq!(evm_sender(r#"{"result":{"from":"0xABC"}}"#).as_deref(), Some("0xabc"));
    }

    #[test]
    fn evm_null_result() {
        assert_eq!(evm_sender(r#"{"jsonrpc":"2.0","id":1,"result":null}"#), None);
        assert_eq!(evm_sender(r#"{"error":{"code":-32000}}"#), None);
    }

    #[test]
    fn btc_inputs() {
        let senders = btc_senders(&fixture("btc-tx.json")).unwrap();
        assert_eq!(senders.len(), 2);
        assert_eq!(senders[0], "bc1q6jqqd4ww2rjcq98zhh78v7mnjg9l78sr0s3sdp");
        assert_eq!(esplora_url("ab"), "https://blockstream.info/api/tx/ab");
    }

    #[test]
    fn btc_coinbase_has_no_sender() {
        assert_eq!(btc_senders(&fixture("btc-coinbase.json")), None);
        assert_eq!(btc_senders(r#"{"vin":[]}"#), None);
    }

    #[test]
    fn btc_input_without_address_fails() {
        let body = r#"{"vin":[{"prevout":{"scriptpubkey_address":"bc1qa"}},{"prevout":{"scriptpubkey_type":"op_return"}}]}"#;
        assert_eq!(btc_senders(body), None);
    }

    #[test]
    fn zec_transparent() {
        let hash = "a5b08edc6ee8ea6c9c652563161be52787cd564831b0c59493c688c39f567fac";
        assert_eq!(
            zec_senders(&fixture("zec-transparent.json"), hash),
            Some(vec!["t1dDepmEjEsfJ1FKPs5KgNRgptNReaXkJZ5".to_string(), "t1fHBMCpDJaFqsJKeEbaJYbgcb5Kx2wGq45".to_string()])
        );
        assert_eq!(zec_senders(&fixture("zec-transparent.json"), "other"), None);
        assert_eq!(blockchair_url("ab"), "https://api.blockchair.com/zcash/dashboards/transaction/ab");
    }

    #[test]
    fn zec_shielded_has_no_sender() {
        let hash = "9cda408ce800d3fa29d1bb1383d6eedd05c31d28a3b934c97960ea49ec2cc947";
        assert_eq!(zec_senders(&fixture("zec-shielded.json"), hash), None);
    }

    const SOL_SIG: &str = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

    #[test]
    fn sol_signers_in_order() {
        assert_eq!(
            sol_senders(&fixture("sol-tx.json")),
            Some(vec!["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM".to_string(), "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH".to_string()])
        );
    }

    #[test]
    fn sol_null_result_none() {
        assert_eq!(sol_senders(r#"{"jsonrpc":"2.0","id":1,"result":null}"#), None);
        let no_signer = r#"{"result":{"transaction":{"message":{"accountKeys":[{"pubkey":"x","signer":false}]}}}}"#;
        assert_eq!(sol_senders(no_signer), None);
    }

    #[test]
    fn sol_rpc_error_none() {
        assert_eq!(sol_senders(r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602}}"#), None);
    }

    #[test]
    fn sol_tx_body_shape() {
        let v: Value = serde_json::from_str(&sol_tx_body(SOL_SIG)).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"jsonrpc":"2.0","id":1,"method":"getTransaction","params":[SOL_SIG,{"encoding":"jsonParsed","maxSupportedTransactionVersion":0,"commitment":"confirmed"}]})
        );
        assert_eq!(SOL_RPC, "https://solana-rpc.publicnode.com");
    }

    #[test]
    fn all_pass_rule() {
        assert!(!all_pass(&[], 50));
        assert!(!all_pass(&[Some(0), None], 50));
        assert!(!all_pass(&[Some(0), Some(100)], 50));
        assert!(all_pass(&[Some(30), Some(0)], 50));
        assert!(all_pass(&[Some(50)], 50));
    }
}
