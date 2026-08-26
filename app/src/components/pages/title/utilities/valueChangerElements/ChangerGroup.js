import { useContext } from "react";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { ChangerList } from "./registry";
import { MobileChangerSheet } from "./MobileChangerSheet";

export function ChangerGroup({ rerenderSetter, valueArrays }) {
  const mobile = useContext(MobileContext);

  if (mobile) {
    return (
      <MobileChangerSheet
        rerenderSetter={rerenderSetter}
        valueArrays={valueArrays}
      />
    );
  }

  return (
    <div
      style={{ position: "absolute", top: "1em", left: "1em" }}
      id="changerGroup"
    >
      <ChangerList valueArrays={valueArrays} rerenderSetter={rerenderSetter} />
    </div>
  );
}

export default ChangerGroup;
