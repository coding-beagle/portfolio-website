import { useContext } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "./styles";

export function DateChanger({ title, callback = null, defaultVal = null }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: mobile ? "space-between" : "flex-start",
        gap: "0.5em",
        width: mobile ? "100%" : undefined,
        marginBottom: "0.5em",
        fontFamily: theme.font,
        color: theme.accent,
      }}
    >
      <span style={{ minWidth: mobile ? 0 : 90, ...noSelect }}>{title}</span>
      <div style={{ zIndex: 10 }}>
        <input
          type="date"
          defaultValue={defaultVal !== null ? defaultVal : null}
          style={{
            fontSize: 16, // keeps iOS from zooming the viewport on focus
            minHeight: mobile ? 40 : undefined,
            fontFamily: theme.font,
          }}
          onChange={(val) => {
            callback({ $d: new Date(val.target.value) });
          }}
        />
      </div>
    </div>
  );
}

export default DateChanger;
