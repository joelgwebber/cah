package cah

import (
	"net/http"
	"encoding/json"
	"math/rand"
	"strconv"
	"appengine/datastore"
	"appengine"
	"errors"
	"bytes"
	"strings"
	"log"
)

var dontWrite error = errors.New("don't save")

var blackCards []string
var whiteCards []string

func addCards(dst *[]string, src []string) {
	for _, text := range src {
		*dst = append(*dst, text)
	}
}

func init() {
	log.Printf(">>> starting up")

	addCards(&blackCards, cards_1_black)
	addCards(&blackCards, cards_2_black)
	addCards(&blackCards, cards_3_black)
	addCards(&whiteCards, cards_1_white)
	addCards(&whiteCards, cards_2_white)
	addCards(&whiteCards, cards_3_white)
}

type GameBlob struct {
	Json []byte
}

func game(ctx appengine.Context, fn func(game *Game) error) {
	// TODO: transactionalize, retry loop.
	key := datastore.NewKey(ctx, "Game", "0", 0, nil)
	var blob GameBlob
	var game Game
	err := datastore.Get(ctx, key, &blob)
	if err != nil {
		if err != datastore.ErrNoSuchEntity {
			ctx.Errorf(">>> %s", err)
			return
		}
		game.Reset()
	} else {
		json.NewDecoder(bytes.NewBuffer(blob.Json)).Decode(&game)
	}

	err = fn(&game)
	if err == nil {
		buf := &bytes.Buffer{}
		json.NewEncoder(buf).Encode(game)
		blob.Json = buf.Bytes()
		_, err = datastore.Put(ctx, key, &blob)
	}
	if err != nil {
		ctx.Errorf(">>> %s", err)
	}
}

// Game structs.
type Game struct {
	Blacks   Deck
	Whites   Deck
	Players  map[string]Player // playerId -> Player
	CurBlack Card
	Played   map[string]int // playerId -> cardId
	Score    map[string]int // playerId -> score
}

func (g *Game) Reset() {
	g.Played = make(map[string]int)
	g.Score = make(map[string]int)
	g.Players = make(map[string]Player)

	g.Blacks = Deck(make([]Card, 0))
	g.Whites = Deck(make([]Card, 0))
	g.Blacks.Populate(blackCards)
	g.Whites.Populate(whiteCards)
	g.Whites.Shuffle()
	g.Blacks.Shuffle()

	g.CurBlack = g.Blacks.Deal(1)[0]
}

type Deck []Card

func (d *Deck) Deal(count int) []Card {
	if count > len(*d) {
		count = len(*d)
	}

	result := make([]Card, count)
	for i := 0; i < count; i++ {
		result[i] = (*d)[i]
	}
	*d = (*d)[count:]
	return result
}

func (d *Deck) Add(cards []Card) {
	for _, card := range cards {
		*d = append(*d, card)
	}
}

func (d *Deck) Remove(cardId int) {
	for i, card := range *d {
		if card.Id == cardId {
			*d = append((*d)[0:i], (*d)[i+1:]...)
			return
		}
	}
}

func (d Deck) Shuffle() {
	for i := len(d) - 1; i > 0; i-- {
		j := rand.Intn(i)
		tmp := d[j]
		d[j] = d[i]
		d[i] = tmp
	}
}

func (d *Deck) Populate(cards []string) {
	*d = make([]Card, len(cards))
	for i, text := range cards {
		(*d)[i] = Card{
			Id: i,
			Text: text,
		}
	}
}

type Player struct {
	Id   string
	Name string
	Hand Deck
}

type Card struct {
	Id   int
	Text string
}

// API structs.
type JoinReq struct {
	Name string
}

type StateReq struct {
	PlayerId string
}

type PlayCardReq struct {
	PlayerId string
	CardId   int
}

type CzarReq struct {
	PlayerId string
}

type CzarChoiceReq struct {
	PlayerId        string
	WinningPlayerId string
}

type PlayerState struct {
	Id     string
	Name   string
	Played bool
	Score  int
}

type StateRsp struct {
	PlayerId string
	Black    Card
	Hand     []Card
	Selected int
	Players  []PlayerState
}

type CzarRsp struct {
	Played map[string]Card
}

func JoinHandler(w http.ResponseWriter, r *http.Request) {
	ctx := appengine.NewContext(r)
	game(ctx, func(game *Game) error {
		var req JoinReq
		json.NewDecoder(r.Body).Decode(&req)

		for _, player := range game.Players {
			if strings.ToLower(player.Name) == strings.ToLower(req.Name) {
				sendState(w, game, player.Id)
				return dontWrite
			}
		}

		id := strconv.Itoa(int(rand.Int31()))
		game.Players[id] = Player{Id: id, Name: req.Name, Hand: game.Whites.Deal(10)}
		sendState(w, game, id)
		return nil
	})
}

func StateHandler(w http.ResponseWriter, r *http.Request) {
	ctx := appengine.NewContext(r)
	game(ctx, func(game *Game) error {
		var req StateReq
		json.NewDecoder(r.Body).Decode(&req)

		if _, exists := game.Players[req.PlayerId]; !exists {
			w.WriteHeader(http.StatusBadRequest)
			return dontWrite
		}

		sendState(w, game, req.PlayerId)
		return nil
	})
}

func PlayCardHandler(w http.ResponseWriter, r *http.Request) {
	ctx := appengine.NewContext(r)
	game(ctx, func(game *Game) error {
		req := PlayCardReq{"", -1}
		json.NewDecoder(r.Body).Decode(&req)

		if _, exists := game.Players[req.PlayerId]; !exists {
			w.WriteHeader(http.StatusBadRequest)
			return dontWrite
		}

		if req.CardId == -1 {
			delete(game.Played, req.PlayerId)
		} else {
			game.Played[req.PlayerId] = req.CardId
		}
		sendState(w, game, req.PlayerId)
		return nil
	})
}

func ResetHandler(w http.ResponseWriter, r *http.Request) {
	ctx := appengine.NewContext(r)
	game(ctx, func(game *Game) error {
		game.Reset()
		w.Write([]byte("{}"))
		return nil
	})
}

func CzarHandler(w http.ResponseWriter, r *http.Request) {
	ctx := appengine.NewContext(r)
	game(ctx, func(game *Game) error {
		var req CzarReq
		json.NewDecoder(r.Body).Decode(&req)

		_, thisUserPlayed := game.Played[req.PlayerId]
		if thisUserPlayed || len(game.Played) != len(game.Players) - 1 {
			w.WriteHeader(http.StatusBadRequest)
			return dontWrite
		}

		rsp := CzarRsp{
			Played: make(map[string]Card),
		}
		for playerId, cardId := range game.Played {
			rsp.Played[playerId] = Card{Id: cardId, Text: whiteCards[cardId] }
		}

		json.NewEncoder(w).Encode(&rsp)
		return nil
	})
}

func CzarChoiceHandler(w http.ResponseWriter, r *http.Request) {
	ctx := appengine.NewContext(r)
	game(ctx, func(game *Game) error {
		var req CzarChoiceReq
		json.NewDecoder(r.Body).Decode(&req)

		for playerId, cardId := range game.Played {
			p := game.Players[playerId]
			p.Hand.Remove(cardId)
			p.Hand.Add(game.Whites.Deal(1))
		}

		game.Played = make(map[string]int)
		game.Score[req.WinningPlayerId]++
		if len(game.Blacks) > 0 {
			game.CurBlack = game.Blacks.Deal(1)[0]
		}

		// TODO: End-game case.

		sendState(w, game, req.PlayerId)
		return nil
	})
}

func sendState(w http.ResponseWriter, game *Game, id string) {
	rsp := StateRsp{
		PlayerId: id,
		Black: game.CurBlack,
		Hand: game.Players[id].Hand,
		Selected: -1,
		Players: make([]PlayerState, len(game.Players)),
	}

	if played, hasPlayed := game.Played[id]; hasPlayed {
		rsp.Selected = played
	}

	i := 0
	for id, player := range game.Players {
		_, hasPlayed := game.Played[id]
		rsp.Players[i] = PlayerState{
			Id:     id,
			Name:   player.Name,
			Played: hasPlayed,
			Score:  game.Score[id],
		}
		i++
	}

	json.NewEncoder(w).Encode(&rsp)
}
