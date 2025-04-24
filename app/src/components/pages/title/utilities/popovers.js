// import { Popover } from "antd";
import { faMouse } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import defaultColours from "../../../../themes/themes";

// const mouseContent = (
//   <div
//     style={{
//       backgroundColor: defaultColours.primary,
//       color: defaultColours.accent,
//       fontFamily: defaultColours.font,
//     }}
//   >
//     <p>This page contains interactions with the mouse!</p>
//   </div>
// );

export default function MouseTooltip() {
  return (
    <div style={{ fontSize: "2em" }}>
      <FontAwesomeIcon icon={faMouse} />
    </div>
  );
}
