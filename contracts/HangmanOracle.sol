pragma solidity ^0.4.19;

contract HangmanOracle {

  address public owner;

  mapping(uint => bool) public validWords;

  event ValidWord(string word, bool isValid);
  event checkWordViaApis(string word);

  function HangmanOracle() public {
    owner = msg.sender;
  }

  function checkWordValidity(string hangWord) public {
    checkWordViaApis(hangWord);
    //ValidWord(hangWord, false);
  }

  function saveWordValidity(string hangWord, bool isValid) public {
    uint wordHash = uint(keccak256(hangWord));
    validWords[wordHash] = isValid;
    ValidWord(hangWord, isValid);
  }
}
