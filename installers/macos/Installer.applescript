try
    display dialog "Close Illustrator and After Effects before installing. Sendwich will install its Adobe panels for your user, allow unsigned Adobe CEP extensions for your user, and copy the development plugin for Figma to Documents." with title "Install Sendwich" buttons {"Cancel", "Install"} default button "Install" cancel button "Cancel"
    set installerPath to POSIX path of (path to resource "install.sh")
    set manifestPath to do shell script "/bin/bash " & quoted form of installerPath
    display dialog ("Open Window > Extensions > Sendwich in After Effects and Illustrator. In Figma Desktop, import the manifest from:" & return & return & manifestPath) with title "Sendwich installed" buttons {"Done"} default button "Done"
on error errorText number errorNumber
    if errorNumber is not -128 then
        display dialog "Installation could not finish. " & errorText with title "Sendwich" buttons {"Close"} default button "Close" with icon stop
    end if
end try
