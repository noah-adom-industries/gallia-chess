"""
Entry point.

Starts the Flask web server for DAQ970A instrument control.
"""

from server import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
