import React from 'react';
import { Link } from 'react-router-dom';

import './header.css';

const Header = () => {
  return (
    <nav className="navbar pure-menu pure-menu-horizontal">
      <Link className="pure-menu-heading pure-menu-link" to="/">
        ETHERMAN
      </Link>
    </nav>
  );
};

export default Header;
