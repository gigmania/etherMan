import React from 'react';
import Header from '../Header/Header';

import './endGame.css';

const EndGame = props => {
  return (
    <div className="end-game-box">
      <div className="end-game-winner">{props.winner}</div>
    </div>
  );
};

export default EndGame;
