{pkgs ? import <nixpkgs> {}}:
pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_24
    pnpm_11
    gnumake
    gcc
    chromium
  ];

  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
}
