pragma solidity ^0.4.19;

import './PendingGame.sol';

contract LiveGame is PendingGame {

  event ActiveGameDetails(string challenger, string hangman, uint wager, uint8 maxTries, string uniqGameString, uint8 wordLength, uint8 tries, uint gameId);
  event SolutionCheck(string letter, uint32 index);
  event MissesCheck(string letter, uint32 index);
  event GameStarted(string challenger, string hangman, uint gameId, uint wager, uint8 maxTries, string uniqGameString, uint8 wordLength);
  event SolutionGuess(string guess, bool hit, uint32 index, uint8 tries);
  event GameWinner(string winner, string word, string loser);
  event WinnerPaid(string winner, bool paid, uint payout);
  event FundsTransfer(address contractAddress, uint wager, bool success);

  struct ActiveGame {
    string word;
    uint wager;
    uint8 maxTries;
    string uniqGameString;
    string hangman;
    string challenger;
    uint8 tries;
    string[] hits;
    string[] misses;
    uint8 wordLength;
    address hangmanAddress;
    address challengerAddress;
  }

  ActiveGame[] public activeGames;
  mapping(address => uint) public activeGamesMap;

  function checkSendHits() private {
    string memory holder = '$';
    for (uint32 i = 0; i < activeGames[activeGamesMap[msg.sender]].hits.length; i++) {
      if (bytes(activeGames[activeGamesMap[msg.sender]].hits[i])[0] != bytes(holder)[0]) {
        SolutionCheck(activeGames[activeGamesMap[msg.sender]].hits[i], i);
      }
    }
  }

  function checkSendMisses() private {
    for (uint32 i = 0; i < activeGames[activeGamesMap[msg.sender]].misses.length; i++) {
      MissesCheck(activeGames[activeGamesMap[msg.sender]].misses[i], i);
    }
  }

  function payWinner(address winnerAddress, string challenger, uint payout) public payable {
    if (winnerAddress.send(payout)) {
      WinnerPaid(challenger, true, payout);
    } else {
      FundsTransfer(this, msg.value, false);
    }
  }

  function checkWordGuess(string guess, uint gameId) private {
    string memory gameWord = activeGames[gameId].word;
    bool isSolved = true;
    if (bytes(gameWord).length == bytes(guess).length) {
      for (uint32 i = 0; i < bytes(gameWord).length; i++) {
        if (bytes(gameWord)[i] != bytes(guess)[i]) {
          isSolved = false;
          checkHanged(gameId, guess);
          break;
        }
      }
      if (isSolved == true) {
        uint totalWager =  activeGames[gameId].wager + activeGames[gameId].wager;
        uint payout = (totalWager/100) * 97;
        payWinner(activeGames[gameId].challengerAddress, activeGames[gameId].challenger, payout);
        GameWinner(activeGames[gameId].challenger, activeGames[gameId].word, activeGames[gameId].hangman);
      }
    } else {
      checkHanged(gameId, guess);
    }
  }

  function reallyCommenceLiveGame(string challenger, uint gameId, string uniqGameString, uint8 wordLength) public {
    string memory gameWord = games[gameId].word;
    uint8 tries = 0;
    string[] memory hits;
    string[] memory misses;
    uint id = activeGames.push(ActiveGame(gameWord, games[gameId].wager, games[gameId].tries, uniqGameString, games[gameId].userName, challenger, tries, hits, misses, wordLength, games[gameId].hangmanAddress, msg.sender)) - 1;
    GameStarted(challenger, games[gameId].userName, id, games[gameId].wager, games[gameId].tries, uniqGameString, wordLength);
    initSolutionArray(wordLength, id);
    mapLiveGameToAddress(id);
    removeGameFromPending(gameId);
  }

  function getActiveGame() public {
    uint gameId = getMapIndex(msg.sender);
    ActiveGameDetails(activeGames[activeGamesMap[msg.sender]].challenger,
      activeGames[activeGamesMap[msg.sender]].hangman,
      activeGames[activeGamesMap[msg.sender]].wager,
      activeGames[activeGamesMap[msg.sender]].maxTries,
      activeGames[activeGamesMap[msg.sender]].uniqGameString,
      activeGames[activeGamesMap[msg.sender]].wordLength,
      activeGames[activeGamesMap[msg.sender]].tries,
      gameId
    );
    checkSendHits();
    checkSendMisses();
  }

  function checkGuess(string guess, uint gameId) public {
    activeGames[gameId].tries++;
    bool isHit = false;
    string memory gameWord = activeGames[gameId].word;
    if (bytes(guess).length > 1) {
      checkWordGuess(guess, gameId);
    } else if (bytes(guess).length == 1) {
      for (uint32 i = 0; i < bytes(gameWord).length; i++) {
        if (bytes(gameWord)[i] == bytes(guess)[0]) {
          isHit = true;
          activeGames[gameId].hits[i] = guess;
          SolutionGuess(guess, true, i, activeGames[gameId].tries);
        }
      }
      if (isHit == true) {
        checkSolved(gameId);
      }
      if (isHit == false) {
        checkHanged(gameId, guess);
      }
    }
  }

  function checkHanged(uint gameId, string guess) private {
    if (activeGames[gameId].maxTries > activeGames[gameId].tries) {
      SolutionGuess(guess, false, 0, activeGames[gameId].tries);
      activeGames[gameId].misses.push(guess);
    } else {
      GameWinner(activeGames[gameId].hangman, activeGames[gameId].word, activeGames[gameId].challenger);
    }
  }

  function getMapIndex(address challenger) private view returns(uint) {
    return activeGamesMap[challenger];
  }

  function initSolutionArray(uint8 wordLength, uint gameIndex) private {
    for (uint32 i = 0; i < wordLength; i++) {
      activeGames[gameIndex].hits.push('$');
    }
  }

  function mapLiveGameToAddress(uint gameIndex) private {
    activeGamesMap[msg.sender] = gameIndex;
  }

  function checkSolved(uint gameId) private {
    string memory gameWord = activeGames[gameId].word;
    bool isSolution = true;
    string memory letter;
    for (uint32 i = 0; i < activeGames[gameId].hits.length; i++) {
      letter = activeGames[gameId].hits[i];
      if (bytes(letter)[0] != bytes(gameWord)[i]) {
        isSolution = false;
        break;
      }
    }
    if (isSolution == true) {
      GameWinner(activeGames[gameId].challenger, activeGames[gameId].word, activeGames[gameId].hangman);
    }
    if (isSolution == false) {
      if (activeGames[gameId].tries >= activeGames[gameId].maxTries) {
        GameWinner(activeGames[gameId].hangman, activeGames[gameId].word, activeGames[gameId].challenger);
      }
    }
  }
}
