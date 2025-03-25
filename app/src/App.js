import React from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import Title from "./components/pages/title/title";
import defaultColours from "./themes/themes";

// Wrapper component to handle location and pass path
function AppWrapper() {
  const location = useLocation();

  // Remove the leading '/' from the pathname
  const path = location.pathname.substring(1);

  return (
    <div
      className="App"
      style={{
        backgroundColor: defaultColours.primary,
        color: defaultColours.accent,
        fontFamily: defaultColours.font,
        height: "100vh",
        margin: 0,
      }}
    >
      <Title text={path} />
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={<AppWrapper />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
