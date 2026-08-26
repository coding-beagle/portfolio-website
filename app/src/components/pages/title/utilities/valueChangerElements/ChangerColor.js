import { useContext } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "./styles";

export function ChangerColor({ rerenderSetter, title, colorValue, onChange }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const swatchSize = mobile ? 44 : 32;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: mobile ? "space-between" : "flex-start",
        gap: mobile ? "0.6em" : 0,
        width: mobile ? "100%" : undefined,
        minHeight: mobile ? 44 : undefined,
        marginBottom: "0.3em",
      }}
    >
      <span
        style={{
          minWidth: mobile ? 0 : 120,
          flex: mobile ? "0 0 38%" : undefined,
          fontSize: mobile ? 15 : undefined,
          ...noSelect,
        }}
      >
        {title}
      </span>
      <input
        type="color"
        value={colorValue}
        onChange={(e) => {
          onChange(e.target.value);
          rerenderSetter((prev) => prev + 1);
        }}
        style={{
          marginLeft: mobile ? 0 : "0.5em",
          width: swatchSize,
          height: swatchSize,
          border: `0px solid ${theme.secondaryAccent}`,
          borderRadius: mobile ? 10 : 6,
          background: `linear-gradient(45deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`,
          boxShadow: `0 1px 6px ${theme.secondaryAccent}22`,
          fontFamily: theme.font,
          fontWeight: 500,
          transition: "background 0.15s, border 0.15s, box-shadow 0.15s",
          cursor: "pointer",
          touchAction: "manipulation",
        }}
        onMouseOver={(e) => {
          if (mobile) return;
          e.target.style.background = `linear-gradient(45deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%)`;
          e.target.style.boxShadow = `0 2px 10px ${theme.secondaryAccent}44`;
        }}
        onMouseOut={(e) => {
          if (mobile) return;
          e.target.style.background = `linear-gradient(45deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`;
          e.target.style.boxShadow = `0 1px 6px ${theme.secondaryAccent}22`;
        }}
      />
    </div>
  );
}

export default ChangerColor;
