import React, { Component } from 'react';
import Header from './Header';

import './css/createGame.css';

class CreateGame extends Component {
  constructor(props) {
    super(props);
    this.state = {
      userName: '',
      word: '',
      wager: undefined,
      tries: undefined
    };
    this.updateUserName = this.updateUserName.bind(this);
    this.updateWager = this.updateWager.bind(this);
    this.updateTries = this.updateTries.bind(this);
    this.updateWord = this.updateWord.bind(this);
    this.createNewGame = this.createNewGame.bind(this);
  }

  createNewGame(e) {
    e.preventDefault();
    let self = this;
    let account = this.props.accounts[0];
    let hangmanInstance;
    let wager = new Number(this.state.wager).valueOf();
    let tries = new Number(this.state.tries).valueOf();
    let word = this.state.word.trim();
    let userName = this.state.userName;
    let userWord = new Date().getTime() + userName + tries + ':000$' + wager;
    let wordLength = word.length;
    console.log('i am the state ---> ', this.state);
    console.log('i am the userWord ---> ', userWord);
    console.log(typeof userWord);
    this.props.hangmanContract
      .deployed()
      .then(function(instance) {
        hangmanInstance = instance;
        return hangmanInstance.createGame(word, wager, tries, userWord, userName, wordLength, {
          from: account,
          gas: 3000000
        });
      })
      .then(function(result) {
        console.log('i am the result ---> ', result);
        self.setState({
          userName: '',
          word: '',
          wager: undefined,
          tries: undefined
        });
      })
      .catch(function(err) {
        console.log(err);
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
  render() {
    return (
      <div className="main-box">
        <Header />
        <div className="header-title flex-justify">
          <div className="games-list-title">
            <h1>Etherman</h1>
            <h2>A PvP game of Hangman for Ether</h2>
          </div>
        </div>
        <div className="left-box">
          <div className="ether-user new-game-input">
            <input
              id="ether-user__input"
              type="text"
              placeholder="Enter UserName Here"
              value={this.state.userName}
              onChange={this.updateUserName}
            />
          </div>
          <div className="ether-word new-game-input">
            <input
              id="ether-word__input"
              type="text"
              placeholder="Enter Word Here"
              value={this.state.word}
              onChange={this.updateWord}
            />
          </div>
          <div className="ether-wager new-game-input">
            <input
              id="ether-wager__input"
              type="text"
              placeholder="Enter Wager Amount Here"
              value={this.state.wager}
              onChange={this.updateWager}
            />
          </div>
          <div className="ether-guess new-game-input">
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
    );
  }
}

export default CreateGame;
