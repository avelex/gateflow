//! 1Click status binding (spec "Deferred screening binds the 1Click deposit") and origin chain lookup.

use serde_json::Value;

pub const BASE: &str = "https://1click.chaindefuser.com/v0";
pub const TOKENS_URL: &str = "https://1click.chaindefuser.com/v0/tokens";

/// `/v0/status` for a deposit address, percent-encoded.
pub fn status_url(deposit_address: &str) -> String {
    let mut encoded = String::new();
    for b in deposit_address.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            encoded.push(b as char);
        } else {
            encoded.push_str(&format!("%{b:02X}"));
        }
    }
    format!("{BASE}/status?depositAddress={encoded}")
}

/// True only for a `SUCCESS` swap whose quote pays `contract` exactly `amount`
/// with a `customRecipientMsg` naming `invoice` and `reference`.
pub fn binding(body: &str, contract: &str, invoice: u64, reference: &str, amount: &str) -> bool {
    check(body, contract, invoice, reference, amount).unwrap_or(false)
}

fn check(body: &str, contract: &str, invoice: u64, reference: &str, amount: &str) -> Option<bool> {
    let v: Value = serde_json::from_str(body).ok()?;
    let quote = v.get("quoteResponse")?;
    let request = quote.get("quoteRequest")?;
    let msg: Value = serde_json::from_str(request.get("customRecipientMsg")?.as_str()?).ok()?;
    Some(
        v.get("status")?.as_str()? == "SUCCESS"
            && request.get("recipient")?.as_str()? == contract
            && msg.get("invoice")?.as_u64()? == invoice
            && msg.get("ref")?.as_str()? == reference
            && quote.get("quote")?.get("amountOut")?.as_str()? == amount,
    )
}

/// Origin `blockchain` of the quote (looked up in `/v0/tokens`) and its origin tx hashes; `None` if there are none.
pub fn origin(body: &str, tokens: &str) -> Option<(String, Vec<String>)> {
    let v: Value = serde_json::from_str(body).ok()?;
    let asset = v.get("quoteResponse")?.get("quoteRequest")?.get("originAsset")?.as_str()?;
    let tokens: Value = serde_json::from_str(tokens).ok()?;
    let chain = tokens
        .as_array()?
        .iter()
        .find(|t| t.get("assetId").and_then(Value::as_str) == Some(asset))?
        .get("blockchain")?
        .as_str()?
        .to_string();
    let hashes = v
        .get("swapDetails")?
        .get("originChainTxHashes")?
        .as_array()?
        .iter()
        .map(|h| Some(h.get("hash")?.as_str()?.to_string()))
        .collect::<Option<Vec<_>>>()?;
    (!hashes.is_empty()).then_some((chain, hashes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;

    fn success() -> String {
        fixture("oneclick-status-success.json")
    }

    fn with_msg(msg: &str) -> String {
        let mut v: Value = serde_json::from_str(&success()).unwrap();
        v["quoteResponse"]["quoteRequest"]["customRecipientMsg"] = Value::String(msg.into());
        v.to_string()
    }

    #[test]
    fn url_encodes_address() {
        assert_eq!(status_url("0xab"), "https://1click.chaindefuser.com/v0/status?depositAddress=0xab");
        assert_eq!(status_url("a&b=c"), "https://1click.chaindefuser.com/v0/status?depositAddress=a%26b%3Dc");
    }

    #[test]
    fn binding_accepts_success() {
        assert!(binding(&success(), "gateflow.test", 0, "r1", "10000000"));
    }

    #[test]
    fn binding_rejects_processing() {
        assert!(!binding(&fixture("oneclick-status-processing.json"), "gateflow.test", 0, "r1", "10000000"));
    }

    #[test]
    fn binding_rejects_wrong_ref() {
        assert!(!binding(&success(), "gateflow.test", 0, "r2", "10000000"));
    }

    #[test]
    fn binding_rejects_wrong_invoice() {
        assert!(!binding(&success(), "gateflow.test", 1, "r1", "10000000"));
    }

    #[test]
    fn binding_rejects_wrong_recipient() {
        assert!(!binding(&success(), "other.test", 0, "r1", "10000000"));
    }

    #[test]
    fn binding_rejects_bad_msg() {
        assert!(!binding(&with_msg("not json"), "gateflow.test", 0, "r1", "10000000"));
        assert!(!binding(&with_msg(r#"{"invoice":"0","ref":"r1"}"#), "gateflow.test", 0, "r1", "10000000"));
        assert!(binding(&with_msg(r#"{"invoice":0,"ref":"r1","gateway":3}"#), "gateflow.test", 0, "r1", "10000000"));
        assert!(!binding("<html>", "gateflow.test", 0, "r1", "10000000"));
    }

    #[test]
    fn binding_rejects_amount_format() {
        assert!(!binding(&success(), "gateflow.test", 0, "r1", "1e7"));
        assert!(!binding(&success(), "gateflow.test", 0, "r1", "10000001"));
    }

    #[test]
    fn origin_base() {
        let hash = "0xf9a9f5c6f35ed62de1daa7bd8578ee8b8814a0efbd6715b742dfed665a41b22f".to_string();
        assert_eq!(origin(&success(), &fixture("oneclick-tokens.json")), Some(("base".into(), vec![hash])));
    }

    #[test]
    fn origin_unknown_asset() {
        assert_eq!(origin(&success(), "[]"), None);
        assert_eq!(origin(&fixture("oneclick-status-processing.json"), &fixture("oneclick-tokens.json")), None);
    }
}
