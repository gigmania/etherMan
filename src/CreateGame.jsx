import React, { Component } from 'react';

class CreateGame extends Component {
  constructor(props) {
    super(props);
    this.state = {
      userName: '',
      word: '',
      wager: undefined,
      tries: undefined
    };
  }
  render() {
    return (
      <div className="main-box">
        <nav className="navbar pure-menu pure-menu-horizontal">
          <a href="#" className="pure-menu-heading pure-menu-link">
            ETHERMAN
          </a>
        </nav>
        <div className="header-title flex-justify">
          <div className="games-list-title">
            <h1>Etherman</h1>
            <h2>A PvP game of Hangman for Ether</h2>
          </div>
        </div>
        <div className="left-box">
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
    );
  }
}

export default CreateGame;
