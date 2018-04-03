package app

import (
	"net/http"
	"cah"
)

func init() {
	http.HandleFunc("/join", cah.JoinHandler)
	http.HandleFunc("/state", cah.StateHandler)
	http.HandleFunc("/playCard", cah.PlayCardHandler)
	http.HandleFunc("/reset", cah.ResetHandler)
	http.HandleFunc("/czar", cah.CzarHandler)
	http.HandleFunc("/czarChoice", cah.CzarChoiceHandler)
}
