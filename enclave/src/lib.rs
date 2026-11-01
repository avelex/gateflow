//! Gateflow screening enclave: verdict rules for the OutLayer guest in `main.rs`.

pub mod goplus;
pub mod ofac;
pub mod origin;
pub mod request;

#[cfg(test)]
mod testing;
