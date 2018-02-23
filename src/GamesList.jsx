import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import ListGame from './ListGame';

class GamesList extends Component {
  constructor(props) {
    super(props);

    this.state = {
      gameStarted: false
    };
  }

  startLiveGame(game) {
    // e.preventDefault();
    console.log(this.props);
    let self = this;
    let account = this.props.accounts[9];
    let liveGameInstance;
    let wager = new Number(this.props.wager).valueOf();
    let tries = new Number(this.props.tries).valueOf();
    let word = this.state.word;
    let userName = this.state.userName;
    let userWord = word + wager + userName + tries;
    console.log('i am the state ---> ', this.state);
    // this.props.liveGameContract
    //   .deployed()
    //   .then(function(instance) {
    //     liveGameInstance = instance;
    //     return liveGameInstance.startLiveGame(word, wager, tries, userWord, userName, {
    //       from: account,
    //       gas: 3000000
    //     });
    //   })
    //   .then(function(result) {
    //     console.log('i am the result ---> ', result);
    //   })
    //   .catch(function(err) {
    //     console.log(err);
    //   });
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
            return <div>Hi</div>;
            // return (
            //   <div className="pending-game" key={game.userWord}>
            //     <div className="game-attr user">
            //       <b> {game.userName} </b>
            //     </div>
            //     <div className="game-attr letters">
            //       <b> {game.word.length} </b>
            //     </div>
            //     <div className="game-attr wager">
            //       <b> {game.wager} </b>
            //     </div>
            //     <div className="game-attr tries">
            //       <b> {game.tries} </b>
            //     </div>
            //     <div className="game-attr play-game">
            //       <button className="play-game__btn" onClick={this.startLiveGame(game)}>
            //         PLAY
            //       </button>
            //     </div>
            //   </div>
            // );
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
          <div className="create-new-game">
            <Link className="game-route-btn" to="/create-game">
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
