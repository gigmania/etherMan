import React, { Component } from 'react';
import { Route, Switch } from 'react-router-dom';
import HangmanContract from '../build/contracts/Hangman.json';
import getWeb3 from './utils/getWeb3';
import GamesList from './GamesList';
import CreateGame from './CreateGame';

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
    const Hangman = contract(HangmanContract);
    Hangman.setProvider(this.state.web3.currentProvider);
    this.setState({
      hangmanContract: Hangman
    });

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
          self.handlePendingGameResult(result);
        });
        hangmanInstance.getPendingGames({ from: accounts[0] });
        this.setState({
          account: accounts[0],
          accounts: accounts
        });
      });
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
        <Switch>
          <Route exact path="/" component={() => <GamesList pendingGames={this.state.pendingGames} />} />
          <Route
            path="/create-game"
            component={() => <CreateGame account={this.state.account} hangmanContract={this.state.hangmanContract} />}
          />
        </Switch>
      </div>
    );
  }
}

export default App;
