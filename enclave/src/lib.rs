//! Gateflow screening enclave: verdict rules for the OutLayer guest in `main.rs`.

pub mod flows;
pub mod goplus;
pub mod ofac;
pub mod oneclick;
pub mod origin;
pub mod request;

#[cfg(test)]
mod testing;

use flows::{verdict, Fetch};

/// `None` (prints `null`) unless the caller is the Gateflow contract; otherwise always a verdict.
pub fn run(stdin: &str, predecessor: Option<&str>, contract: &str, fetch: Fetch) -> Option<bool> {
    if predecessor != Some(contract) {
        return None;
    }
    Some(request::parse_request(stdin).is_some_and(|req| verdict(req, contract, fetch)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: &str = r#"{"kind":"screen","payer":"alice.testnet","max_risk":50}"#;

    fn offline(_: &flows::Http) -> Option<String> {
        None
    }

    #[test]
    fn foreign_caller_null() {
        assert_eq!(run(SCREEN, Some("evil.near"), "gateflow.test", &offline), None);
    }

    #[test]
    fn missing_caller_null() {
        assert_eq!(run(SCREEN, None, "gateflow.test", &offline), None);
    }

    #[test]
    fn garbage_stdin_false() {
        assert_eq!(run("{", Some("gateflow.test"), "gateflow.test", &offline), Some(false));
        assert_eq!(run("", Some("gateflow.test"), "gateflow.test", &offline), Some(false));
    }

    #[test]
    fn contract_caller_runs() {
        assert_eq!(run(SCREEN, Some("gateflow.test"), "gateflow.test", &offline), Some(false));
    }
}
