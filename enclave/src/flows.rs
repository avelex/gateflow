//! The two screenings. Every failure along the way is a `false` verdict (delta spec "Every Gateflow execution ends in a verdict").

use crate::goplus::{goplus_score, goplus_url};
use crate::ofac::{ofac_score, XBT_LIST, ZEC_LIST};
use crate::oneclick::{binding, origin, status_url, TOKENS_URL};
use crate::origin::{all_pass, blockchair_url, btc_senders, esplora_url, evm_rpc, evm_sender, evm_tx_body, zec_senders};
use crate::request::{is_evm_account, Request};

/// One outbound request. `body` is set only for the EVM JSON-RPC POST.
#[derive(Debug, Clone, PartialEq)]
pub struct Http {
    pub method: &'static str,
    pub url: String,
    pub body: Option<String>,
}

pub type Fetch<'a> = &'a dyn Fn(&Http) -> Option<String>;

fn get(fetch: Fetch, url: String) -> Option<String> {
    fetch(&Http { method: "GET", url, body: None })
}

pub fn verdict(req: Request, contract: &str, fetch: Fetch) -> bool {
    match req {
        Request::Screen { payer, max_risk } => screen(&payer, max_risk, fetch),
        Request::ScreenIntents { deposit_address, invoice, reference, amount, max_risk } => {
            screen_intents(&deposit_address, invoice, &reference, &amount, max_risk, contract, fetch).unwrap_or(false)
        }
    }
}

/// Direct payment: only an implicit EVM account that GoPlus rates at or below `max_risk` passes.
fn screen(payer: &str, max_risk: u8, fetch: Fetch) -> bool {
    is_evm_account(payer) && all_pass(&[evm_score(payer, fetch)], max_risk)
}

fn evm_score(addr: &str, fetch: Fetch) -> Option<u8> {
    goplus_score(&get(fetch, goplus_url(addr))?)
}

fn screen_intents(
    deposit_address: &str,
    invoice: u64,
    reference: &str,
    amount: &str,
    max_risk: u8,
    contract: &str,
    fetch: Fetch,
) -> Option<bool> {
    let status = get(fetch, status_url(deposit_address))?;
    if !binding(&status, contract, invoice, reference, amount) {
        return Some(false);
    }
    let (chain, hashes) = origin(&status, &get(fetch, TOKENS_URL.into())?)?;
    // Hashes go into URLs and JSON-RPC params: hex (with optional 0x) only.
    if !hashes.iter().all(|h| !h.is_empty() && h.bytes().all(|b| b.is_ascii_alphanumeric())) {
        return Some(false);
    }
    let scores: Vec<Option<u8>> = if let Some(rpc) = evm_rpc(&chain) {
        let mut scores = Vec::new();
        for hash in &hashes {
            let tx = fetch(&Http { method: "POST", url: rpc.into(), body: Some(evm_tx_body(hash)) })?;
            scores.push(evm_score(&evm_sender(&tx)?, fetch));
        }
        scores
    } else if chain == "btc" {
        let list = get(fetch, XBT_LIST.into())?;
        let mut scores = Vec::new();
        for hash in &hashes {
            let senders = btc_senders(&get(fetch, esplora_url(hash))?)?;
            scores.extend(senders.iter().map(|s| Some(ofac_score(&list, s))));
        }
        scores
    } else if chain == "zec" {
        let list = get(fetch, ZEC_LIST.into())?;
        let mut scores = Vec::new();
        for hash in &hashes {
            let senders = zec_senders(&get(fetch, blockchair_url(hash))?, hash)?;
            scores.extend(senders.iter().map(|s| Some(ofac_score(&list, s))));
        }
        scores
    } else {
        return Some(false);
    };
    Some(all_pass(&scores, max_risk))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;
    use serde_json::{json, Value};
    use std::cell::RefCell;
    use std::collections::HashMap;

    const CONTRACT: &str = "gateflow.test";
    const CLEAN: &str = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const SEVERE: &str = "0x098b716b8aaf21512996dc57eb0615e2383e2f96";
    const SENDER: &str = "0xaec29d0ce4995a3e3dec32b01ca018305eb485d4";
    const DEP: &str = "0x1111111111111111111111111111111111111111";

    /// URL (or "POST <url> <tx hash>") -> body; unknown keys return `None`. Records every call.
    struct Net {
        routes: HashMap<String, String>,
        calls: RefCell<Vec<String>>,
    }

    impl Net {
        fn new(routes: &[(String, String)]) -> Self {
            Net { routes: routes.iter().cloned().collect(), calls: RefCell::new(Vec::new()) }
        }
        fn run(&self, req: Request) -> bool {
            verdict(req, CONTRACT, &|h: &Http| {
                let key = match &h.body {
                    Some(b) => {
                        let v: Value = serde_json::from_str(b).unwrap();
                        format!("POST {} {}", h.url, v["params"][0].as_str().unwrap())
                    }
                    None => h.url.clone(),
                };
                self.calls.borrow_mut().push(key.clone());
                self.routes.get(&key).cloned()
            })
        }
        fn count(&self, url: &str) -> usize {
            self.calls.borrow().iter().filter(|c| c.as_str() == url).count()
        }
    }

    fn screen_req(payer: &str) -> Request {
        Request::Screen { payer: payer.into(), max_risk: 50 }
    }

    fn intents_req() -> Request {
        Request::ScreenIntents {
            deposit_address: DEP.into(),
            invoice: 0,
            reference: "r1".into(),
            amount: "10000000".into(),
            max_risk: 50,
        }
    }

    /// Success status with the given origin asset and tx hashes.
    fn status(asset: &str, hashes: &[&str]) -> String {
        let mut v: Value = serde_json::from_str(&fixture("oneclick-status-success.json")).unwrap();
        v["quoteResponse"]["quoteRequest"]["originAsset"] = json!(asset);
        v["swapDetails"]["originChainTxHashes"] = json!(hashes.iter().map(|h| json!({"hash": h})).collect::<Vec<_>>());
        v.to_string()
    }

    const BASE_USDC: &str = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
    const BTC: &str = "nep141:btc.omft.near";

    fn r(k: impl Into<String>, v: impl Into<String>) -> (String, String) {
        (k.into(), v.into())
    }

    fn evm_tx_from(from: &str) -> String {
        json!({"jsonrpc": "2.0", "id": 1, "result": {"from": from}}).to_string()
    }

    fn base_routes(status_body: String) -> Vec<(String, String)> {
        vec![r(status_url(DEP), status_body), r(TOKENS_URL, fixture("oneclick-tokens.json"))]
    }

    #[test]
    fn named_payer_no_fetch() {
        let net = Net::new(&[]);
        assert!(!net.run(screen_req("alice.testnet")));
        assert!(net.calls.borrow().is_empty());
    }

    #[test]
    fn clean_evm_payer() {
        let net = Net::new(&[r(goplus_url(CLEAN), fixture("goplus-clean.json"))]);
        assert!(net.run(screen_req(CLEAN)));
    }

    #[test]
    fn severe_evm_payer() {
        let net = Net::new(&[r(goplus_url(SEVERE), fixture("goplus-severe.json"))]);
        assert!(!net.run(screen_req(SEVERE)));
    }

    #[test]
    fn goplus_down() {
        assert!(!Net::new(&[]).run(screen_req(CLEAN)));
    }

    #[test]
    fn intents_clean_base() {
        let hash = "0xf9a9f5c6f35ed62de1daa7bd8578ee8b8814a0efbd6715b742dfed665a41b22f";
        let mut routes = base_routes(fixture("oneclick-status-success.json"));
        routes.push(r(format!("POST https://base-rpc.publicnode.com {hash}"), fixture("evm-tx.json")));
        routes.push(r(goplus_url(SENDER), fixture("goplus-clean.json")));
        assert!(Net::new(&routes).run(intents_req()));
    }

    #[test]
    fn intents_processing() {
        let net = Net::new(&[r(status_url(DEP), fixture("oneclick-status-processing.json"))]);
        assert!(!net.run(intents_req()));
        assert_eq!(net.calls.borrow().len(), 1);
    }

    #[test]
    fn intents_unsupported_chain() {
        let sol = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
        let net = Net::new(&base_routes(status(sol, &["abc"])));
        assert!(!net.run(intents_req()));
        assert_eq!(net.calls.borrow().len(), 2);
    }

    #[test]
    fn two_txs_one_flagged() {
        let mut routes = base_routes(status(BASE_USDC, &["0xa1", "0xa2"]));
        routes.push(r("POST https://base-rpc.publicnode.com 0xa1", evm_tx_from(CLEAN)));
        routes.push(r("POST https://base-rpc.publicnode.com 0xa2", evm_tx_from(SEVERE)));
        routes.push(r(goplus_url(CLEAN), fixture("goplus-clean.json")));
        routes.push(r(goplus_url(SEVERE), fixture("goplus-severe.json")));
        assert!(!Net::new(&routes).run(intents_req()));
    }

    #[test]
    fn btc_list_fetched_once() {
        let mut routes = base_routes(status(BTC, &["b1", "b2"]));
        routes.push(r(XBT_LIST, fixture("ofac-xbt.txt")));
        routes.push(r(esplora_url("b1"), fixture("btc-tx.json")));
        routes.push(r(esplora_url("b2"), fixture("btc-tx.json")));
        let net = Net::new(&routes);
        assert!(net.run(intents_req()));
        assert_eq!(net.count(XBT_LIST), 1);
    }

    #[test]
    fn btc_sanctioned_input() {
        let tx = json!({"vin": [{"prevout": {"scriptpubkey_address": "123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX"}}]}).to_string();
        let mut routes = base_routes(status(BTC, &["b1"]));
        routes.push(r(XBT_LIST, fixture("ofac-xbt.txt")));
        routes.push(r(esplora_url("b1"), tx));
        assert!(!Net::new(&routes).run(intents_req()));
    }

    #[test]
    fn zec_shielded_fails() {
        let hash = "9cda408ce800d3fa29d1bb1383d6eedd05c31d28a3b934c97960ea49ec2cc947";
        let mut routes = base_routes(status("nep141:zec.omft.near", &[hash]));
        routes.push(r(ZEC_LIST, fixture("ofac-zec.txt")));
        routes.push(r(blockchair_url(hash), fixture("zec-shielded.json")));
        assert!(!Net::new(&routes).run(intents_req()));
    }

    #[test]
    fn zec_transparent_passes() {
        let hash = "a5b08edc6ee8ea6c9c652563161be52787cd564831b0c59493c688c39f567fac";
        let mut routes = base_routes(status("nep141:zec.omft.near", &[hash]));
        routes.push(r(ZEC_LIST, fixture("ofac-zec.txt")));
        routes.push(r(blockchair_url(hash), fixture("zec-transparent.json")));
        assert!(Net::new(&routes).run(intents_req()));
    }

    #[test]
    fn chain_api_down() {
        let mut routes = base_routes(status(BTC, &["b1"]));
        routes.push(r(XBT_LIST, fixture("ofac-xbt.txt")));
        assert!(!Net::new(&routes).run(intents_req()));
    }

    #[test]
    fn hash_with_path_chars_fails() {
        let net = Net::new(&base_routes(status(BTC, &["../x?y"])));
        assert!(!net.run(intents_req()));
        assert_eq!(net.calls.borrow().len(), 2);
    }
}
