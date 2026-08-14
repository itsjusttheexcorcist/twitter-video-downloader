const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

function validTwitterUrl(value) {
  try {
    const url = new URL(value);

    return (
      ["twitter.com", "www.twitter.com", "x.com", "www.x.com"].includes(
        url.hostname
      ) &&
      /\/status\/\d+/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

app.post("/api/download", (req, res) => {
  const url = req.body?.url;

  if (!url || !validTwitterUrl(url)) {
    return res.status(400).json({
      error: "Please enter a valid public X/Twitter post URL."
    });
  }

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "twt-download-")
  );

  console.log("Downloading:", url);

  // twt-dl-cli accepts the URL as its command-line argument.
  const downloader = spawn(
    "npx",
    [
      "--yes",
      "twt-dl-cli@latest",
      url
    ],
    {
      cwd: tempDir,
      env: {
        ...process.env
      }
    }
  );

  let output = "";
  let errorOutput = "";

  downloader.stdout.on("data", (data) => {
    const text = data.toString();
    output += text;
    console.log(text);
  });

  downloader.stderr.on("data", (data) => {
    const text = data.toString();
    errorOutput += text;
    console.log(text);
  });

  downloader.on("error", (error) => {
    console.error("Downloader failed to start:", error);

    cleanup();

    if (!res.headersSent) {
      res.status(500).json({
        error: "The video downloader could not start."
      });
    }
  });

  downloader.on("close", (code) => {
    console.log("twt-dl-cli exited with:", code);

    if (code !== 0) {
      console.error(errorOutput);

      cleanup();

      if (!res.headersSent) {
        res.status(500).json({
          error:
            "The video could not be downloaded. Try another public X post."
        });
      }

      return;
    }

    let files;

    try {
      files = fs.readdirSync(tempDir);
    } catch (error) {
      console.error(error);
      cleanup();

      return res.status(500).json({
        error: "Could not read the downloaded file."
      });
    }

    console.log("Files created:", files);

    // Find the largest video file produced by twt-dl-cli.
    const videoFiles = files
      .map((file) => path.join(tempDir, file))
      .filter((file) => {
        try {
          return (
            fs.statSync(file).isFile() &&
            /\.(mp4|m4v|mov|webm|mkv)$/i.test(file)
          );
        } catch {
          return false;
        }
      });

    if (videoFiles.length === 0) {
      console.error(
        "No video file found.",
        output,
        errorOutput
      );

      cleanup();

      return res.status(500).json({
        error:
          "The downloader ran, but did not produce a video file."
      });
    }

    // If multiple files exist, use the largest one.
    videoFiles.sort(
      (a, b) =>
        fs.statSync(b).size - fs.statSync(a).size
    );

    const videoFile = videoFiles[0];
    const fileSize = fs.statSync(videoFile).size;

    if (fileSize === 0) {
      cleanup();

      return res.status(500).json({
        error: "The downloaded video was empty."
      });
    }

    console.log(
      `Video found: ${(fileSize / 1024 / 1024).toFixed(2)} MB`
    );

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", fileSize);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="X-video.mp4"'
    );

    const stream = fs.createReadStream(videoFile);

    stream.pipe(res);

    stream.on("close", cleanup);

    stream.on("error", (error) => {
      console.error("Streaming error:", error);
      cleanup();
    });
  });

  function cleanup() {
    try {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true
      });
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
