import React, { Component } from 'react';
import SimpleStorageContract from '../build/contracts/SimpleStorage.json';
import HangmanContract from '../build/contracts/Hangman.json';
import getWeb3 from './utils/getWeb3';
import GamesList from './GamesList';

import './css/oswald.css';
import './css/open-sans.css';
import './css/pure-min.css';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      storageValue: 0,
      web3: null,
      pendingGameIds: {},
      pendingGames: [],
      userName: '',
      word: '',
      wager: undefined,
      tries: undefined,
      hangmanContract: undefined,
      account: undefined,
      accounts: []
    };
    this.updateUserName = this.updateUserName.bind(this);
    this.updateWager = this.updateWager.bind(this);
    this.updateTries = this.updateTries.bind(this);
    this.updateWord = this.updateWord.bind(this);
    this.createNewGame = this.createNewGame.bind(this);
    this.addGameToGames = this.addGameToGames.bind(this);
    this.handlePendingGameResult = this.handlePendingGameResult.bind(this);
    this.handleNewGameResult = this.handleNewGameResult.bind(this);
    this.gameMaker = this.gameMaker.bind(this);
  }

  componentWillMount() {
    // Get network provider and web3 instance.
    // See utils/getWeb3 for more info.

    getWeb3
      .then(results => {
        this.setState({
          web3: results.web3
        });

        // Instantiate contract once web3 provided.
        this.instantiateContract();
      })
      .catch(() => {
        console.log('Error finding web3.');
      });
  }
  addGameToGames(game) {
    let gameIds = this.state.pendingGameIds;
    let games = this.state.pendingGames;
    if (this.state.pendingGameIds[game.userWord] == null) {
      console.log('ADDING GAME TO GAMES');
      gameIds[game.userWord] = game.userWord;
      games.push(game);
      this.setState({
        pendingGameIds: gameIds,
        pendingGames: games
      });
    }
  }
  handlePendingGameResult(pendingGame) {
    let game = this.gameMaker(pendingGame.args);
    this.addGameToGames(game);
  }
  handleNewGameResult(newGame) {
    let game = this.gameMaker(newGame.args);
    this.addGameToGames(game);
  }
  gameMaker(game) {
    let userName = game.userName;
    let word = game.word;
    let userWord = game.userWord;
    let wager = game.wager.c[0];
    let tries = game.tries.c[0];
    return {
      word,
      wager,
      tries,
      userName,
      userWord
    };
  }

  instantiateContract() {
    let self = this;
    const contract = require('truffle-contract');
    const simpleStorage = contract(SimpleStorageContract);
    const Hangman = contract(HangmanContract);
    Hangman.setProvider(this.state.web3.currentProvider);
    simpleStorage.setProvider(this.state.web3.currentProvider);
    this.setState({
      hangmanContract: Hangman
    });

    // Declaring this for later so we can chain functions on SimpleStorage.
    var simpleStorageInstance;
    let hangmanInstance;

    // Get accounts.
    this.state.web3.eth.getAccounts((error, accounts) => {
      this.state.hangmanContract.deployed().then(instance => {
        hangmanInstance = instance;
        console.log('I am the instance ---> ', hangmanInstance);
        hangmanInstance.PendingGame(function(error, result) {
          self.handlePendingGameResult(result);
        });
        hangmanInstance.NewGame(function(error, result) {
          console.log(result);
          self.handlePendingGameResult(result);
        });
        hangmanInstance.getPendingGames({ from: accounts[0] });
        this.setState({
          account: accounts[0],
          accounts: accounts
        });
      });

      // simpleStorage
      //   .deployed()
      //   .then(instance => {
      //     simpleStorageInstance = instance;
      //
      //     // Stores a given value, 5 by default.
      //     return simpleStorageInstance.set(77, { from: accounts[0] });
      //   })
      //   .then(result => {
      //     // Get the value from the contract to prove it worked.
      //     return simpleStorageInstance.get.call(accounts[0]);
      //   })
      //   .then(result => {
      //     // Update state with the result.
      //     return this.setState({ storageValue: result.c[0] });
      //   });
    });
  }

  updateUserName(e) {
    e.preventDefault();
    this.setState({
      userName: e.target.value
    });
  }

  updateWord(e) {
    e.preventDefault();
    this.setState({
      word: e.target.value
    });
  }

  updateWager(e) {
    e.preventDefault();
    this.setState({
      wager: e.target.value
    });
  }

  updateTries(e) {
    e.preventDefault();
    this.setState({
      tries: e.target.value
    });
  }

  createNewGame(e) {
    e.preventDefault();
    let account = this.state.account;
    let hangmanInstance;
    console.log(this.state);
    let wager = new Number(this.state.wager).valueOf();
    let tries = new Number(this.state.tries).valueOf();
    let word = this.state.word;
    let userName = this.state.userName;
    let userWord = word + wager + userName + tries;
    this.state.hangmanContract
      .deployed()
      .then(function(instance) {
        hangmanInstance = instance;
        return hangmanInstance.createGame(word, wager, tries, userWord, userName, {
          from: account,
          gas: 3000000
        });
      })
      .catch(function(err) {
        console.log(err);
      });
  }

  render() {
    let pendingGames = this.state.pendingGames;
    let gamesList;
    if (this.state.pendingGames && this.state.pendingGames.length > 0) {
      gamesList = (
        <div className="pending-games">
          <div className="pending-games__header">
            <div className="header-user user header-title">Hangman</div>
            <div className="header-letters letters header-title">Number of Letters</div>
            <div className="header-wager wager header-title">Wager</div>
            <div className="header-tries tries header-title">Tries</div>
          </div>
          {pendingGames.map(game => {
            return (
              <div className="pending-game" key={game.userWord}>
                <div className="game-attr user">
                  <b> {game.userName} </b>
                </div>
                <div className="game-attr letters">
                  <b> {game.word.length} </b>
                </div>
                <div className="game-attr wager">
                  <b> {game.wager} </b>
                </div>
                <div className="game-attr tries">
                  <b> {game.tries} </b>
                </div>
                <div className="game-attr play-game">
                  <button className="play-game__btn">PLAY</button>
                </div>
              </div>
            );
          })}
        </div>
      );
    } else {
      gamesList = <h2> Hello World </h2>;
    }
    return (
      <div className="App">
        <nav className="navbar pure-menu pure-menu-horizontal">
          <a href="#" className="pure-menu-heading pure-menu-link">
            ETHERMAN
          </a>
        </nav>

        <main className="container">
          <div className="left-box">
            <div className="pure-u-1-1">
              <h1>Etherman</h1>
              <h2>A PvP game of Hangman for Ether</h2>
              <div className="ether-user">
                <input
                  id="ether-user__input"
                  type="text"
                  placeholder="Enter UserName Here"
                  value={this.state.userName}
                  onChange={this.updateUserName}
                />
              </div>
              <div className="ether-word">
                <input
                  id="ether-word__input"
                  type="text"
                  placeholder="Enter Word Here"
                  value={this.state.word}
                  onChange={this.updateWord}
                />
              </div>
              <div className="ether-wager">
                <input
                  id="ether-wager__input"
                  type="text"
                  placeholder="Enter Wager Amount Here"
                  value={this.state.wager}
                  onChange={this.updateWager}
                />
              </div>
              <div className="ether-guess">
                <input
                  id="ether-guess__input"
                  type="text"
                  placeholder="Enter the Number of Guesses"
                  value={this.state.tries}
                  onChange={this.updateTries}
                />
              </div>
              <div className="start-game">
                <button className="start-game__btn" onClick={this.createNewGame}>
                  Create Game
                </button>
              </div>
            </div>
          </div>
          <GamesList pendingGames={this.state.pendingGames} />
        </main>
      </div>
    );
  }
}

export default App;
