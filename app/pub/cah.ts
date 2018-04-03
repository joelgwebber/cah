module Cah {

  var reqCount = 0;

  function byId(id: string): HTMLElement {
    return document.getElementById(id);
  }

  function byClass(elem: HTMLElement, className: string): HTMLElement {
    return <HTMLElement> elem.getElementsByClassName(className)[0];
  }

  function post(endpoint: string, req: any, cb: (rsp: any, status: number) => void, noSpinner: boolean = false) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);
    xhr.onreadystatechange = () => {
      if (xhr.readyState != 4) {
        return;
      }

      if (!noSpinner) {
        reqCount--;
        if (reqCount == 0) {
          byId("wait").style.display = 'none';
        }
      }

      if (xhr.status == 200) {
        cb(JSON.parse(xhr.responseText), xhr.status);
      } else {
        cb(xhr.responseText, xhr.status);
      }
    };

    if (!noSpinner) {
      reqCount++;
      if (reqCount == 1) {
        byId("wait").style.display = 'block';
      }
    }

    xhr.send(JSON.stringify(req));
  }

  export interface Card {
    Id:   number;
    Text: string;
  }

  export interface PlayerState {
    Id:     string;
    Name:   string;
    Played: boolean;
    Score:  number;
  }

  export interface StateRsp {
    PlayerId:     string;
    Black:        Card;
    Hand:         Card[];
    Selected:     number;
    Players:      PlayerState[];
  }

  export interface CzarRsp {
    Played: {[playerId: string]: Card};
  }

  interface View {
    elem(): HTMLElement;
  }

  export class Client {
    private _joinView: JoinView;
    private _playView: PlayView;
    private _playersView: PlayersView;
    private _czarView: CzarView;
    private _curView: View;

    private _state: StateRsp;

    constructor() {
      this._joinView = new JoinView(this);
      this._playView = new PlayView(this);
      this._playersView = new PlayersView(this);
      this._czarView = new CzarView(this);

      byId("CzarButton").onclick = (e) => {
        post("/czar", {PlayerId: this._state.PlayerId}, (rsp: CzarRsp, status) => {
          if (status != 200) {
            alert('nope');
            return;
          }
          this.showCzarView(rsp);
        });
      };

      byId("ResetButton").onclick = (e) => {
        if (!confirm("This will start the game over with a new deck and players.\nAre you sure?")) {
          return;
        }
        post("/reset", {}, (_, status) => {
          if (status != 200) {
            alert('nope');
            return;
          }
          this._playersView.elem().innerHTML = "";
          this.showJoinView();
        });
      };

      setInterval(() => {
        if (!this._state) {
          return;
        }
        post("/state", {PlayerId: this._state.PlayerId}, (rsp: StateRsp, status) => {
          if (status != 200) {
            return;
          }
          this.handleState(rsp);
        }, true);
      }, 5000);

      this.showJoinView();
    }

    handleState(state: StateRsp) {
      this._state = state;
      this._playView.render(state);
      this._playersView.render(state);
      if (this._curView != this._czarView) {
        this.showPlayView();
      }
    }

    state(): StateRsp {
      return this._state;
    }

    showJoinView() {
      this.showView(this._joinView);
    }

    showPlayView() {
      this.showView(this._playView);
    }

    showCzarView(rsp: CzarRsp) {
      this.showView(this._czarView);
      this._czarView.render(rsp);
    }

    private showView(view: View) {
      if (this._curView) {
        this._curView.elem().style.display = '';
      }
      this._curView = view;
      this._curView.elem().style.display = 'block';
    }
  }

  class JoinView implements View {
    private _elem: HTMLFormElement;
    private _name: HTMLInputElement;

    constructor(private _ctx: Client) {
      this._elem = <HTMLFormElement>byId("JoinView");
      this._name = <HTMLInputElement>byClass(this._elem, "name");
      this._elem.onsubmit = (e) => {
        e.preventDefault();
        post("/join", {Name: this._name.value}, (rsp: StateRsp, status) => {
          if (status != 200) {
            alert("Failed to join");
            return;
          }

          this._ctx.handleState(rsp);
        });
      };
    }

    elem(): HTMLElement { return this._elem; }
  }

  class PlayView implements View {
    private _elem: HTMLElement;
    private _blackContainer: HTMLElement;
    private _whitesContainer: HTMLElement;
    private _cards: CardView[];

    constructor(private _ctx: Client) {
      this._elem = byId("PlayView");
      this._blackContainer = byClass(this._elem, "black");
      this._whitesContainer = byClass(this._elem, "whites");
    }

    elem(): HTMLElement { return this._elem; }

    render(state: StateRsp) {
      this._blackContainer.innerHTML = '';
      var view = new CardView(state.Black, true);
      this._blackContainer.appendChild(view.elem());

      this._cards = [];
      this._whitesContainer.innerHTML = '';
      for (var i = 0; i < state.Hand.length; ++i) {
        this.addWhiteCard(state.Hand[i], state.Selected);
      }
    }

    private addWhiteCard(card: Card, selected: number) {
      var view = new CardView(card, false);
      this._cards.push(view);
      this._whitesContainer.appendChild(view.elem());
      if (card.Id == selected) {
        view.setSelected(true);
      }
      view.elem().onclick = (e) => {
        var state = this._ctx.state();
        var req = {
          PlayerId: state.PlayerId,
          CardId: -1
        };
        if (state.Selected != card.Id) {
          req.CardId = card.Id;
        }
        post("/playCard", req, (rsp: StateRsp, status) => {
          if (status != 200) {
            alert("nope");
            return;
          }
          this._ctx.handleState(rsp);
        });
      };
    }
  }

  class PlayersView implements View {
    private _elem: HTMLElement;

    constructor(private _ctx: Client) {
      this._elem = byId("PlayersView");
    }

    elem(): HTMLElement { return this._elem; }

    render(state: StateRsp) {
      this.elem().innerHTML = '';
      for (var i = 0; i < state.Players.length; ++i) {
        this.addPlayer(state.Players[i]);
      }
    }

    private addPlayer(player: PlayerState) {
      var view = new PlayerView(this._ctx);
      this._elem.appendChild(view.elem());
      view.render(player);
    }
  }

  class PlayerView implements View {
    private _id: string;
    private _elem: HTMLElement;
    private _played: HTMLElement;
    private _name: HTMLElement;
    private _score: HTMLElement;

    constructor(private _ctx: Client) {
      this._elem = <HTMLElement>byId("PlayerView").cloneNode(true);
      this._elem.style.display = 'block';
      this._played = <HTMLElement>byClass(this._elem, "played");
      this._name = <HTMLElement>byClass(this._elem, "name");
      this._score = <HTMLElement>byClass(this._elem, "score");
    }

    elem(): HTMLElement { return this._elem; }

    render(state: PlayerState) {
      this._id = state.Id;
      this._name.textContent = state.Name;
      this._played.textContent = state.Played ? "x" : "-";
      this._score.textContent = '' + state.Score;
    }
  }

  class CzarView implements View {
    private _elem: HTMLElement;
    private _black: HTMLElement;
    private _whites: HTMLElement;

    constructor(private _ctx: Client) {
      this._elem = byId("CzarView");
      this._black = byClass(this._elem, "black");
      this._whites = byClass(this._elem, "whites");
      byClass(this._elem, "cancel").onclick = (e) => {
        this._ctx.showPlayView();
      };
    }

    elem(): HTMLElement { return this._elem; }

    render(rsp: CzarRsp) {
      this.setBlackCard(this._ctx.state().Black);
      this._whites.innerHTML = "";
      for (var playerId in rsp.Played) {
        var card = rsp.Played[playerId];
        this.addWhiteCard(playerId, card);
      }
    }

    private setBlackCard(card: Card) {
      this._black.innerHTML = "";
      var view = new CardView(card, true);
      this._black.appendChild(view.elem());
    }

    private addWhiteCard(playerId: string, card: Card) {
      var view = new CardView(card, false);
      this._whites.appendChild(view.elem());
      view.elem().onclick = (e) => {
        if (!confirm(card.Text + "\nIs that your final answer?")) {
          return;
        }

        post("/czarChoice", { PlayerId: this._ctx.state().PlayerId, WinningPlayerId: playerId }, (rsp: StateRsp, status) => {
          this._ctx.showPlayView();
          if (status != 200) {
            alert('nope');
            return;
          }
          this._ctx.handleState(rsp);
        });
      };
    }
  }

  class CardView implements View {
    private _elem: HTMLElement;
    private _selected = false;

    constructor(private _card: Card, black: boolean) {
      this._elem = document.createElement('div');
      this._elem.className = 'Card ' + (black ? 'black' : 'white');
      this._elem.textContent = _card.Text;
    }

    elem(): HTMLElement { return this._elem; }

    selected(): boolean { return this._selected; }

    setSelected(selected: boolean) {
      this._selected = selected;
      if (selected) {
        this._elem.classList.add('selected');
      } else {
        this._elem.classList.remove('selected');
      }
    }
  }
}

new Cah.Client();
