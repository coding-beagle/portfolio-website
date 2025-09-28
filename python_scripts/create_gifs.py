import pyscreenrec
import webbrowser
import time
from moviepy.editor import VideoFileClip
from os import makedirs
import sys
from PIL import Image

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


def convert_vid_to_gif(video_path: str, gif_path: str) -> None:
    videoClip = VideoFileClip(f"recordings/{video_path}.mp4")
    makedirs("outgifs/", exist_ok=True)
    videoClip.write_gif(f"outgifs/{gif_path}.gif", fps=GIF_FPS)


def do_record(scene_name: str) -> None:
    recorder = pyscreenrec.ScreenRecorder()
    makedirs("recordings", exist_ok=True)
    recorder.start_recording(
        f"recordings/{scene_name}.mp4",
        GIF_FPS,
        {"mon": 1, "left": 0, "top": 100, "width": 1920, "height": 920},
    )

    time.sleep(10)

    recorder.stop_recording()


def resize_gif(input_path, output_path, width, height):
    img = Image.open(input_path)
    print(img)
    frames = []
    durations = []

    transparency = img.info.get("transparency", None)
    disposal = img.info.get("disposal", 2)
    last_frame = Image.new("RGBA", img.size)

    try:
        while True:
            frame = img.convert("RGBA")

            if disposal == 2:
                combined = frame
            else:
                combined = Image.alpha_composite(last_frame, frame)

            resized_frame = combined.resize((width, height), Image.LANCZOS)
            frames.append(resized_frame.convert("P", palette=Image.ADAPTIVE))

            durations.append(img.info["duration"])
            last_frame = combined if disposal != 2 else frame.copy()

            img.seek(img.tell() + 1)
    except EOFError:
        pass

    save_kwargs = {
        "save_all": True,
        "append_images": frames[1:],
        "loop": 0,
        "duration": durations,
        "disposal": disposal,
    }

    if transparency is not None:
        save_kwargs["transparency"] = transparency

    frames[0].save(output_path, **save_kwargs)


def create_preview_gif(scene_name: str):
    create_website_window(scene_name)
    do_record(scene_name)
    convert_vid_to_gif(scene_name, scene_name)
    resize_gif(
        f"outgifs/{scene_name}.gif", f"outgifs/{scene_name}_resized.gif", 600, 400
    )


create_preview_gif("rain")
