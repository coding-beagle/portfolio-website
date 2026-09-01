import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { noSelect } from "../title/utilities/valueChangerElements/styles";

/**
 * The four digits both devices work out for themselves, and the owner's
 * decision.
 *
 * This is the one part of the encryption a person has to take part in. The
 * server relays the two public keys, so in principle it could relay two of its
 * own and read everything in between. It cannot make both devices arrive at the
 * same four digits while doing that — so if they match, nothing tampered with
 * the exchange.
 *
 * Which is only true if somebody looks. Hence the number set large on both
 * screens, and an owner who has to say yes rather than a dialog that can be
 * dismissed by reflex.
 */
export default function HandshakeGate({ handshake, onAdmit, onTurnAway }) {
  const { theme } = useTheme();
  const isOwner = handshake.role === "owner";

  const button = (extra) => ({
    ...noSelect,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5em",
    padding: "0.6em 1.1em",
    fontFamily: "inherit",
    fontSize: "0.95rem",
    borderRadius: 6,
    cursor: "pointer",
    color: theme.accent,
    ...extra,
  });

  return (
    <section
      role="dialog"
      aria-label="Confirm the other device"
      style={{
        border: `1px solid ${theme.secondary}66`,
        background: `${theme.secondary}0F`,
        borderRadius: 8,
        padding: "1.2em",
        marginBottom: "1.4em",
      }}
    >
      <p
        style={{
          ...noSelect,
          margin: "0 0 0.2em",
          fontSize: "0.7rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity: 0.6,
        }}
      >
        {isOwner ? "A device wants to join" : "Waiting to be let in"}
      </p>

      <p
        aria-label={`Confirmation code ${handshake.sas.split("").join(" ")}`}
        style={{
          margin: "0.2em 0 0.5em",
          fontFamily: "monospace",
          fontSize: "2.4rem",
          letterSpacing: "0.24em",
          color: theme.secondary,
        }}
      >
        {handshake.sas}
      </p>

      <p style={{ margin: "0 0 1em", fontSize: "0.86rem", opacity: 0.75, maxWidth: "42em" }}>
        {isOwner
          ? "Check the other device is showing these same four digits, then let it in. If they differ, something is sitting between you, so turn it away."
          : "Check the device that started the session is showing these same four digits. It has to let you in before anything is shared."}
      </p>

      {isOwner && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6em" }}>
          <button
            className="utControl"
            onClick={onAdmit}
            style={button({
              border: `1px solid ${theme.secondaryAccent}`,
              background: `${theme.secondaryAccent}26`,
            })}
          >
            <FontAwesomeIcon icon={faCheck} />
            They match, let it in
          </button>
          <button
            className="utControl"
            onClick={onTurnAway}
            style={button({
              border: `1px solid ${theme.tertiaryAccent}`,
              background: `${theme.tertiaryAccent}1A`,
            })}
          >
            <FontAwesomeIcon icon={faXmark} />
            Turn away
          </button>
        </div>
      )}
    </section>
  );
}
