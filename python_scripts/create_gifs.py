import pyscreenrec
import webbrowser
import time
from moviepy.editor import VideoFileClip
from os import makedirs, rmdir
import sys
from PIL import Image, ImageSequence
import pyautogui
from shutil import rmtree

PORT = 3000
BASE_URL = f"http://localhost:{PORT}/#?"

GIF_FPS = 30


def create_website_window(
    scene: str, hide_ui: bool = False, shake_off: bool = True
) -> None:
    """Open a new screen that has
    www.nteague.com/#?scene=scene&shake=off(hide_ui && '&hide=yes')?

    Args:
        url_suffix (str):
    """
    url: str = BASE_URL + f"scene={scene}"

    url += "&shake=off" if shake_off else ""
    url += "&hide=true" if hide_ui else ""

    webbrowser.open(url, new=0)


RESIZE_FACTOR = 2


def convert_vid_to_gif(video_path: str, gif_path: str) -> None:
    videoClip = VideoFileClip(f"recordings/{video_path}.mp4")
    makedirs("outgifs/", exist_ok=True)
    videoClip.subclip(-1).resize(
        (int(1920 / RESIZE_FACTOR), int(920 / RESIZE_FACTOR))
    ).write_gif(f"outgifs/{gif_path}.gif", fps=GIF_FPS)


def do_record(scene_name: str, drag: bool) -> None:
    recorder = pyscreenrec.ScreenRecorder()
    makedirs("recordings", exist_ok=True)
    recorder.start_recording(
        f"recordings/{scene_name}.mp4",
        GIF_FPS,
        {"mon": 1, "left": 0, "top": 100, "width": 1920, "height": 920},
    )

    time.sleep(1)

    ## in case we get webpack error
    for _ in range(10):
        pyautogui.leftClick(1890, 120)
        time.sleep(0.1)

    if drag:
        time.sleep(1)
        pyautogui.moveTo(x=460, y=300)
        pyautogui.dragTo(x=960, y=200, duration=0.5)
        pyautogui.dragTo(x=1460, y=300, duration=0.5)
    else:
        time.sleep(2)

    recorder.stop_recording()


def create_preview_gif(scene_name: str, drag: bool = False) -> None:
    create_website_window(scene_name)
    do_record(scene_name, drag)
    convert_vid_to_gif(scene_name, scene_name)
    pyautogui.hotkey("ctrl", "w")


SCENES = {
    "snow": False,
    "rain": True,
    "plants": False,
    "stars": True,
    "boids": True,
    "conway": True,
    "hexapod": True,
    "mandelbrot": True,
    "fire": True,
    "fireworks": False,
    "plinko": False,
    "gravitalorbs": False,
    "liquid": True,
    "life": False,
    "raven": True,
    "clocks": True,
    "pinball": True,
    "ballpit": True,
    "pid": True,
}

rmtree("recordings")
rmtree("outgifs")

for scene, drag in SCENES.items():
    create_preview_gif(scene, drag)

with open("../README.md", "w") as f:
    new_text = """# Nicholas Teague's public portfolio website

## Scene previews:"""

    for scene in SCENES:
        new_text += f"\n\n###{scene.capitalize()}:\n![{scene.upper()}](python_scripts/outgifs/{scene}.gif)"

    new_text += """\n\n## Make Commands:

`make install` -> Install JS deps

`make run` -> Run webpack to render website locally

`make clean` -> Clear out node_modules
"""
    f.write(new_text)
