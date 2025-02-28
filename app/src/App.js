import Title from "./components/Title";
import defaultColours from "./themes/themes";

function App() {
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
      <Title />
    </div>
  );
}

export default App;
