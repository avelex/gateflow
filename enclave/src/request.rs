use serde::Deserialize;

/// One screening request, exactly as the Gateflow contract writes it into `input_data`.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Request {
    Screen { payer: String, max_risk: u8 },
    ScreenIntents {
        deposit_address: String,
        invoice: u64,
        #[serde(rename = "ref")]
        reference: String,
        amount: String,
        max_risk: u8,
    },
}

pub fn parse_request(stdin: &str) -> Option<Request> {
    serde_json::from_str(stdin).ok()
}

/// An implicit EVM NEAR account: `0x` + 40 lowercase hex.
pub fn is_evm_account(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s.bytes().skip(2).all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_kinds() {
        assert_eq!(
            parse_request(r#"{"kind":"screen","payer":"alice.near","max_risk":50}"#),
            Some(Request::Screen { payer: "alice.near".into(), max_risk: 50 })
        );
        assert_eq!(
            parse_request(r#"{"kind":"screen_intents","deposit_address":"dep1","invoice":0,"ref":"r1","amount":"10000000","max_risk":50}"#),
            Some(Request::ScreenIntents {
                deposit_address: "dep1".into(),
                invoice: 0,
                reference: "r1".into(),
                amount: "10000000".into(),
                max_risk: 50
            })
        );
    }

    #[test]
    fn unknown_kind_is_none() {
        assert_eq!(parse_request(r#"{"kind":"approve","payer":"a","max_risk":1}"#), None);
        assert_eq!(parse_request("{"), None);
    }

    #[test]
    fn uppercase_hex_payer_fails() {
        assert!(is_evm_account("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"));
        assert!(!is_evm_account("0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045"));
        assert!(!is_evm_account("alice.testnet"));
        assert!(!is_evm_account(&"a".repeat(64)));
        assert!(!is_evm_account("0xd8da6bf26964af9d7eed9e03e53415d37aa9604"));
    }
}
