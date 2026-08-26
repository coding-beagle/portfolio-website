import { useContext } from "react";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { CHANGER_TYPE } from "./types";
import { Slider } from "./Slider";
import { ChangerButton } from "./ChangerButton";
import { ChangerColor } from "./ChangerColor";
import { DisplayEntity } from "./DisplayEntity";
import { DateChanger } from "./DateChanger";

/** Maps each named changer type onto the component that renders it. */
export const CHANGER_COMPONENTS = {
  [CHANGER_TYPE.SLIDER]: Slider,
  [CHANGER_TYPE.BUTTON]: ChangerButton,
  [CHANGER_TYPE.COLOR]: ChangerColor,
  [CHANGER_TYPE.DISPLAY]: DisplayEntity,
  [CHANGER_TYPE.DATE]: DateChanger,
};

/** Renders one descriptor, or a group of descriptors when given an array. */
export function Changer({ entry, rerenderSetter }) {
  const mobile = useContext(MobileContext);

  if (Array.isArray(entry)) {
    return (
      <div
        style={{
          display: "flex",
          gap: mobile ? "0.35em" : "0.5em",
          alignItems: mobile ? "stretch" : "center",
          flexDirection: mobile ? "column" : "row",
          flexWrap: mobile ? "nowrap" : "wrap",
          width: mobile ? "100%" : undefined,
        }}
      >
        {entry.map((subEntry, subIndex) => (
          <Changer
            key={subIndex}
            entry={subEntry}
            rerenderSetter={rerenderSetter}
          />
        ))}
      </div>
    );
  }

  const Component = entry && CHANGER_COMPONENTS[entry.type];
  if (!Component) return null;
  return <Component {...entry} rerenderSetter={rerenderSetter} />;
}

/** Renders a whole `valueArrays` config. */
export function ChangerList({ valueArrays, rerenderSetter }) {
  return valueArrays.map((entry, index) => (
    <Changer key={index} entry={entry} rerenderSetter={rerenderSetter} />
  ));
}
