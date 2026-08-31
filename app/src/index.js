import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));

/*
 * One source tree, two deployables. `REACT_APP_TARGET=hextool` builds the hex
 * tool for its own subdomain; anything else builds the portfolio. The import is
 * dynamic so webpack splits the two into separate chunks and each build only
 * ever downloads its own.
 */
const rootModule =
  process.env.REACT_APP_TARGET === "hextool"
    ? import('./HexApp')
    : import('./App');

rootModule.then(({ default: Root }) => {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
