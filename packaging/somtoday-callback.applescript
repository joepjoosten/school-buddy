-- School Buddy: catches the somtoday:// OAuth redirect and hands it to the daemon.
-- Compiled to an .app by install.sh (osacompile) and registered for the
-- somtoday:// URL scheme, so the browser can complete the login automatically.
on open location theURL
	try
		set json to "{\"redirectUrl\":\"" & theURL & "\"}"
		set result to do shell script "curl -s -m 10 -X POST 'http://127.0.0.1:4823/api/somtoday/connect/finish' -H 'content-type: application/json' -d " & quoted form of json
		if result contains "\"ok\":true" then
			display notification "Somtoday is gekoppeld ✅" with title "School Buddy"
		else
			display notification "Koppelen mislukt — probeer het opnieuw via Instellingen" with title "School Buddy"
		end if
	on error errMsg
		display notification "Koppelen mislukt: " & errMsg with title "School Buddy"
	end try
end open location
