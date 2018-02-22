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
        <main className="container">
          <h1>Etherman</h1>
          <h2>A PvP game of Hangman for Ether</h2>
        </main>
      </div>
    );
  }
}

export default CreateGame;
