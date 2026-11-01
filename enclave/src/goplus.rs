//! GoPlus address security score (delta spec "GoPlus risk score").

use serde_json::Value;

/// Flag weights. Fields not listed (e.g. `contract_address`, `data_source`) score 0.
const WEIGHTS: &[(&str, u8)] = &[
    ("sanctioned", 100),
    ("stealing_attack", 100),
    ("cybercrime", 100),
    ("money_laundering", 100),
    ("financial_crime", 100),
    ("darkweb_transactions", 100),
    ("blackmail_activities", 100),
    ("phishing_activities", 100),
    ("mixer", 70),
    ("honeypot_related_address", 70),
    ("fake_kyc", 70),
    ("malicious_mining_activities", 70),
    ("fake_token", 70),
    ("number_of_malicious_contracts_created", 70),
    ("blacklist_doubt", 30),
    ("gas_abuse", 30),
    ("reinit", 30),
    ("fake_standard_interface", 30),
];

pub fn goplus_url(addr: &str) -> String {
    format!("https://api.gopluslabs.io/api/v1/address_security/{addr}?chain_id=1")
}

/// Highest weight among the flags GoPlus sets, 0 when none; `None` unless `code == 1` with a `result` object.
pub fn goplus_score(body: &str) -> Option<u8> {
    let v: Value = serde_json::from_str(body).ok()?;
    if v.get("code")?.as_i64()? != 1 {
        return None;
    }
    let result = v.get("result")?.as_object()?;
    Some(
        WEIGHTS
            .iter()
            .filter(|(field, _)| result.get(*field).is_some_and(is_set))
            .map(|(_, w)| *w)
            .max()
            .unwrap_or(0),
    )
}

/// GoPlus sends flags as `"0"`/`"1"` strings (counts as decimal strings); numbers are accepted too.
fn is_set(v: &Value) -> bool {
    match v {
        Value::String(s) => s.trim().parse::<u64>().is_ok_and(|n| n > 0),
        Value::Number(n) => n.as_u64().is_some_and(|n| n > 0),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;

    #[test]
    fn url() {
        assert_eq!(goplus_url("0xab"), "https://api.gopluslabs.io/api/v1/address_security/0xab?chain_id=1");
    }

    #[test]
    fn score_tiers() {
        assert_eq!(goplus_score(&fixture("goplus-clean.json")), Some(0));
        assert_eq!(goplus_score(&fixture("goplus-low.json")), Some(30));
        assert_eq!(goplus_score(&fixture("goplus-severe.json")), Some(100));
        assert_eq!(goplus_score(r#"{"code":1,"result":{"mixer":"1","gas_abuse":"1"}}"#), Some(70));
        assert_eq!(goplus_score(r#"{"code":1,"result":{"phishing_activities":1}}"#), Some(100));
    }

    #[test]
    fn malicious_contracts_count() {
        assert_eq!(goplus_score(r#"{"code":1,"result":{"number_of_malicious_contracts_created":"2"}}"#), Some(70));
        assert_eq!(goplus_score(r#"{"code":1,"result":{"number_of_malicious_contracts_created":"0"}}"#), Some(0));
    }

    #[test]
    fn ignores_unlisted_fields() {
        assert_eq!(goplus_score(r#"{"code":1,"result":{"contract_address":"1","data_source":"SlowMist"}}"#), Some(0));
    }

    #[test]
    fn goplus_error() {
        assert_eq!(goplus_score(r#"{"code":2}"#), None);
        assert_eq!(goplus_score(r#"{"code":1,"result":null}"#), None);
        assert_eq!(goplus_score("<html>"), None);
    }
}
