pragma solidity ^0.4.19;

contract PendingGame {

  event NewGame(uint gameId, uint wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event PendingGames(uint gameId, uint wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event RemovePendingGame(string userWord);

  uint32 gamesArrayGaps = 0;

  struct Game {
    string word;
    uint wager;
    uint8 tries;
    string userWord;
    string userName;
    uint8 wordLength;
  }

  Game[] public games;
  mapping(uint => string) public idToWord;

  function reallyCreateGame(string _word, uint _wager, uint8 _tries, string _userWord, string _userName, uint8 _wordLength) internal {
    uint id;
    if (gamesArrayGaps < 1) {
      id = games.push(Game(_word, _wager, _tries, _userWord, _userName, _wordLength)) - 1;
    } else {
      for (uint32 i = 0; i < games.length; i++) {
        if (games[i].wordLength == 0) {
          games[i] = Game(_word, _wager, _tries, _userWord, _userName, _wordLength);
          id = i;
          gamesArrayGaps--;
          break;
        }
      }
    }
    idToWord[id] = _word;
    NewGame(id, _wager, _tries, _userName, _userWord, _wordLength);
  }

  function removeGameFromPending(uint gameId) internal {
    RemovePendingGame(games[gameId].userWord);
    delete games[gameId];
    gamesArrayGaps++;
  }
}
