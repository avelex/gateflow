//! OFAC sanctioned address lists (github.com/0xB10C/ofac-sanctioned-digital-currency-addresses).

pub const XBT_LIST: &str =
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt";
pub const ZEC_LIST: &str =
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ZEC.txt";

/// 100 when `addr` is a line of `list`, else 0.
pub fn ofac_score(list: &str, addr: &str) -> u8 {
    if !addr.is_empty() && list.lines().any(|line| line.trim() == addr) { 100 } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fixture;

    #[test]
    fn ofac_listed() {
        let list = fixture("ofac-zec.txt");
        assert_eq!(ofac_score(&list, "t1LHesgnkapziGQCJtrfZWYXhyjfTVo1dvh"), 100);
        assert_eq!(ofac_score(&list, "t1dDepmEjEsfJ1FKPs5KgNRgptNReaXkJZ5"), 0);
        assert_eq!(ofac_score(&fixture("ofac-xbt.txt"), "123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX"), 100);
    }

    #[test]
    fn ofac_trims_lines() {
        assert_eq!(ofac_score("x\r\naddr \r\n", "addr"), 100);
        assert_eq!(ofac_score("x\n\n", ""), 0);
    }
}
