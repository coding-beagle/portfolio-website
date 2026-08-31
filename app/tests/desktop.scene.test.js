/**
 * The desktop scene: that the shortcuts are the subdomain registry plus the
 * scenes folder, that opening takes two clicks, and that the folder is a real
 * window on the taskbar.
 */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../src/themes/ThemeProvider";
import { MobileContext } from "../src/contexts/MobileContext";
import Desktop from "../src/components/pages/title/scenes/desktop";
import { SUBDOMAIN_APPS, appHref } from "../src/subdomains";

const SCENES = ["snow", "rain", "hyperspace", "desktop"];

const mount = ({ mobile = false, ...props } = {}) => {
  const onLaunch = jest.fn();
  const onOpenScene = jest.fn();
  const onToggleTheme = jest.fn();
  const onToggleVisibleUI = jest.fn();
  render(
    <MobileContext.Provider value={mobile}>
      <ThemeProvider>
        <Desktop
          sceneNames={SCENES}
          currentSceneName="desktop"
          onLaunch={onLaunch}
          onOpenScene={onOpenScene}
          onToggleTheme={onToggleTheme}
          onToggleVisibleUI={onToggleVisibleUI}
          {...props}
        />
      </ThemeProvider>
    </MobileContext.Provider>
  );
  return { onLaunch, onOpenScene, onToggleTheme, onToggleVisibleUI };
};

const shortcut = (label) => screen.getByTitle(label);
/**
 * `hidden: true` because a minimised window is still mounted, only display:none
 * — which the role queries would otherwise treat as not being there at all, and
 * the point of minimising is that the window survives it.
 */
const folderWindow = () => screen.queryByRole("dialog", { hidden: true });
const taskbar = () => within(screen.getByRole("toolbar", { name: "Taskbar" }));

describe("desktop scene", () => {
  it("puts every subdomain app on the desktop, plus the scenes folder", () => {
    mount();
    SUBDOMAIN_APPS.forEach((app) => {
      expect(shortcut(app.name)).toBeInTheDocument();
    });
    expect(shortcut("Scenes")).toBeInTheDocument();
  });

  it("gives each app a real link so it can be opened in a tab", () => {
    mount();
    const app = SUBDOMAIN_APPS[0];
    expect(shortcut(app.name)).toHaveAttribute("href", appHref(app));
  });

  it("selects on the first click and launches on the second", () => {
    const { onLaunch } = mount();
    const app = SUBDOMAIN_APPS[0];

    userEvent.click(shortcut(app.name));
    expect(onLaunch).not.toHaveBeenCalled();

    fireEvent.doubleClick(shortcut(app.name));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ key: app.key }));
  });

  it("opens on a single tap when there is no mouse to double-click with", () => {
    const { onLaunch } = mount({ mobile: true });
    userEvent.click(shortcut(SUBDOMAIN_APPS[0].name));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("opens the scenes folder as a window and lists every scene", () => {
    const { onOpenScene } = mount();
    expect(folderWindow()).toBeNull();

    fireEvent.doubleClick(shortcut("Scenes"));
    const window_ = folderWindow();
    SCENES.forEach((name) => {
      expect(within(window_).getByText(name)).toBeInTheDocument();
    });

    fireEvent.doubleClick(within(window_).getByTitle("hyperspace"));
    expect(onOpenScene).toHaveBeenCalledWith("hyperspace");
  });

  it("marks the scene that is already showing", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    expect(
      within(folderWindow()).getByTitle("desktop (current scene)")
    ).toBeInTheDocument();
  });

  it("minimises the folder to the taskbar and back", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    expect(folderWindow()).toBeVisible();

    userEvent.click(screen.getByLabelText("Minimise"));
    expect(folderWindow()).not.toBeVisible();

    // The taskbar keeps the window, so clicking its button brings it back.
    userEvent.click(taskbar().getByRole("button", { name: /Scenes/ }));
    expect(folderWindow()).toBeVisible();
  });

  it("closes the folder for good", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    userEvent.click(screen.getByLabelText("Close"));
    expect(folderWindow()).toBeNull();
  });

  it("lets a shortcut be dragged, and drops it on the grid", () => {
    mount();
    const icon = shortcut("Scenes");
    // Second in the column: one icon height and gap below the first.
    expect(icon).toHaveStyle({ left: "16px", top: "114px" });


    fireEvent.mouseDown(icon, { clientX: 16, clientY: 114, button: 0 });
    fireEvent.mouseMove(window, { clientX: 216, clientY: 214 });
    fireEvent.mouseUp(window);

    // Dropped between grid cells, so it lands on the nearest one.
    expect(icon).toHaveStyle({ left: "196px", top: "212px" });
  });

  it("does not move a shortcut on a press that never travels", () => {
    const { onLaunch } = mount();
    const icon = shortcut(SUBDOMAIN_APPS[0].name);

    fireEvent.mouseDown(icon, { clientX: 16, clientY: 16, button: 0 });
    fireEvent.mouseMove(window, { clientX: 18, clientY: 17 });
    fireEvent.mouseUp(window);

    expect(icon).toHaveStyle({ left: "16px", top: "16px" });
    // And it is still an ordinary double-click away from opening.
    fireEvent.doubleClick(icon);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("resizes the folder from its corner gripper", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    const window_ = folderWindow();
    expect(window_).toHaveStyle({ width: "520px", height: "380px" });

    fireEvent.mouseDown(screen.getByTitle("Resize"), {
      clientX: 500,
      clientY: 400,
      button: 0,
    });
    fireEvent.mouseMove(window, { clientX: 560, clientY: 440 });
    fireEvent.mouseUp(window);
    expect(window_).toHaveStyle({ width: "580px", height: "420px" });

    // It will not be dragged smaller than something usable.
    fireEvent.mouseDown(screen.getByTitle("Resize"), {
      clientX: 560,
      clientY: 440,
      button: 0,
    });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(window);
    expect(window_).toHaveStyle({ width: "240px", height: "160px" });
  });

  it("carries the page's own theme and hide-UI controls as programs", () => {
    const { onToggleTheme, onToggleVisibleUI } = mount();

    fireEvent.doubleClick(shortcut("Display Properties"));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(shortcut("Show Desktop"));
    expect(onToggleVisibleUI).toHaveBeenCalledTimes(1);
  });

  it("names the hide-UI program for whichever way it will go", () => {
    mount({ visibleUI: false });
    expect(shortcut("Show Page")).toBeInTheDocument();
    expect(screen.queryByTitle("Show Desktop")).toBeNull();
  });

  it("opens apps from the start menu on one click", () => {
    const { onLaunch } = mount();
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();

    userEvent.click(screen.getByLabelText("Start"));
    const menu = screen.getByRole("menu", { name: "Start menu" });

    userEvent.click(within(menu).getByText(SUBDOMAIN_APPS[0].name));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    // Launching something puts the menu away.
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });

  it("turns the computer off by leaving for another scene", () => {
    const { onOpenScene } = mount();
    userEvent.click(screen.getByLabelText("Start"));
    userEvent.click(screen.getByText("Turn Off Computer"));

    expect(onOpenScene).toHaveBeenCalledTimes(1);
    // Anywhere but here.
    expect(onOpenScene.mock.calls[0][0]).not.toBe("desktop");
    expect(SCENES).toContain(onOpenScene.mock.calls[0][0]);
  });

  it("closes the start menu on escape", () => {
    mount();
    userEvent.click(screen.getByLabelText("Start"));
    expect(screen.getByRole("menu", { name: "Start menu" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });
});
