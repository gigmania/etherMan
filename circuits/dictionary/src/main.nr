mod config;
use config::{MAX_WORD_LENGTH, DICTIONARY_DEPTH};
use keccak256::keccak256;
use poseidon::poseidon2::Poseidon2;

// Public input order is part of the Solidity verifier interface.
fn main(
    root: pub Field,
    chain_hi: pub u128,
    chain_lo: pub u128,
    game_contract: pub Field,
    creator: pub Field,
    word_length: pub u8,
    commitment_hi: pub u128,
    commitment_lo: pub u128,
    word: [u8; MAX_WORD_LENGTH],
    salt: [u8; 32],
    siblings: [Field; DICTIONARY_DEPTH],
    directions: [bool; DICTIONARY_DEPTH],
) {
    game_contract.assert_max_bit_size::<160>();
    creator.assert_max_bit_size::<160>();
    assert(word_length > 0 & word_length as u32 <= MAX_WORD_LENGTH);
    let mut packed: Field = 0;
    for i in 0..MAX_WORD_LENGTH {
        if i < word_length as u32 {
            assert(word[i] >= 97 & word[i] <= 122);
        } else {
            assert(word[i] == 0);
        }
        packed = packed * 256 + word[i] as Field;
    }
    let mut node = Poseidon2::hash([1, word_length as Field, packed], 3);
    for i in 0..DICTIONARY_DEPTH {
        let left = if directions[i] { siblings[i] } else { node };
        let right = if directions[i] { node } else { siblings[i] };
        node = Poseidon2::hash([2, left, right], 3);
    }
    assert(node == root);

    // Exact abi.encode(uint256,address,address,string,bytes32), not packed.
    let mut preimage: [u8; 224] = [0; 224];
    let high = (chain_hi as Field).to_be_bytes::<16>();
    let low = (chain_lo as Field).to_be_bytes::<16>();
    let contract_bytes = game_contract.to_be_bytes::<32>();
    let creator_bytes = creator.to_be_bytes::<32>();
    for i in 0..16 {
        preimage[i] = high[i];
        preimage[16 + i] = low[i];
    }
    for i in 0..32 {
        preimage[32 + i] = contract_bytes[i];
        preimage[64 + i] = creator_bytes[i];
        preimage[128 + i] = salt[i];
    }
    preimage[127] = 160;
    preimage[191] = word_length;
    for i in 0..MAX_WORD_LENGTH { preimage[192 + i] = word[i]; }
    let digest = keccak256(preimage, 224);
    let mut hi: u128 = 0;
    let mut lo: u128 = 0;
    for i in 0..16 {
        hi = hi * 256 + digest[i] as u128;
        lo = lo * 256 + digest[16 + i] as u128;
    }
    assert(hi == commitment_hi);
    assert(lo == commitment_lo);
}
