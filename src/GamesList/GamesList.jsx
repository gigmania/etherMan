import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import ListGame from '../ListGame/ListGame';
import Header from '../Header/Header';

import './gamesList.css';

class GamesList extends Component {
  constructor(props) {
    super(props);

    this.state = {
      gameStarted: false
    };
  }

  render() {
    let { pendingGames } = this.props;
    let gamesList;

    if (this.props.pendingGames && this.props.pendingGames.length > 0) {
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
              <ListGame
                key={game.userWord}
                {...game}
                accounts={this.props.accounts}
                hangmanContract={this.props.hangmanContract}
                web3={this.props.web3}
              />
            );
          })}
        </div>
      );
    } else {
      gamesList = (
        <div className="pending-games">
          <div className="pending-games__header">
            <div className="header-user user header-title">Hangman</div>
            <div className="header-letters letters header-title">Number of Letters</div>
            <div className="header-wager wager header-title">Wager</div>
            <div className="header-tries tries header-title">Tries</div>
          </div>
        </div>
      );
    }
    return (
      <div>
        <Header />
        <div className="header-title flex-justify">
          <div className="games-list-title">
            <h1>Etherman</h1>
            <h2>A PvP game of Hangman for Ether</h2>
          </div>
          <div className="create-new-game">
            <Link className="react-link-btn" to="/create-game">
              <button>start new game</button>
            </Link>
          </div>
        </div>
        <div className="right-box">{gamesList}</div>
      </div>
    );
  }
}

export default GamesList;
