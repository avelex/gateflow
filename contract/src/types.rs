use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, NearToken};

pub type GatewayId = u32;
pub type InvoiceId = u64;
pub type PaymentId = u64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Enclave {
    pub outlayer: AccountId,
    pub project: String,
    pub secrets_owner: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Policy {
    pub max_risk: u8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Gateway {
    pub owner: AccountId,
    pub payout_to: AccountId,
    pub policy: Policy,
    pub fuel: NearToken,
    pub invoices: u32,
    pub payments: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InvoiceStatus {
    Open,
    Paying,
    Paid,
    Returned,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub gateway: GatewayId,
    pub token: AccountId,
    pub amount: U128,
    pub expires_at_sec: u64,
    pub memo: Option<String>,
    pub status: InvoiceStatus,
    pub payment: Option<PaymentId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PaymentStatus {
    Pending,
    Settled,
    Refunded,
    SettleFailed,
    RefundFailed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub gateway: GatewayId,
    pub invoice: InvoiceId,
    pub payer: AccountId,
    pub refund_to: AccountId,
    pub token: AccountId,
    pub amount: U128,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub deposit_address: Option<String>,
    pub opened_at_sec: u64,
    pub max_risk: u8,
    pub status: PaymentStatus,
}

/// `msg` of `ft_transfer_call`. Unknown fields (for example `gateway`) are ignored.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayMsg {
    pub invoice: InvoiceId,
    pub refund_to: Option<AccountId>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
}
