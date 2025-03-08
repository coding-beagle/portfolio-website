import Title from "./components/pages/title/title";
import Blog from "./components/pages/blog/blog";
import defaultColours from "./themes/themes";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
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
              <Title />
            </div>
          }
        />
        <Route path="/blog" element={<Blog />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
