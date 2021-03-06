import { Component, OnInit, OnDestroy } from '@angular/core';
import { LoadingController } from '@ionic/angular';

import { APIService } from '../api.service';
import { SettingsService, SEGMENT } from '../settings.service';

import Positions from '../../model/positions';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page implements OnInit, OnDestroy {
  protected positions = {
    first: null,
    second: null,
    third: null,
    home: null,
    pitcher: null,
  } as Positions;

  public data = {} as any;
  public games = [] as any[];
  public searchTerm: string;
  public segment = 'all' as SEGMENT;

  // protected loading: HTMLIonLoadingElement;
  public loading: boolean;
  public ready = false;
  public errors = 0;
  //public lastUpdate = "look, it's been a while, OK?";
  public lastUpdate = Date.now();
  public filterVisible = false;
  public stale = false;
  public staleThreshold = 30 * 1000; // 30s

  private subscription: Subscription;
  private api = new APIService();

  private clockUpdater: number;
  private countdown = {
    hours: 0,
    minutes: 0,
    seconds: 0,
  };

  constructor(public loadingController: LoadingController, protected settings: SettingsService) {
  }

  async ngOnInit() {
    console.debug('Stream.ngOnInit()');
    this.showLoading();
    this.settings.ready.finally(() => {
      this.segment = this.settings.getSegment();
      this.startListening();
      this.ready = true;
    });
  }

  async ngOnDestroy() {
    this.ready = false;
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
      this.api.stop();
    }
  }

  async showLoading() {
    this.loading = true;
    /*
    this.hideLoading();
    this.loading = await this.loadingController.create({
      showBackdrop: false,
      translucent: true,
    });
    this.loading.present();
    */
  }

  async hideLoading() {
    this.loading = false;
    /*
    if (this.loading) {
      this.loading.dismiss();
    }
    */
  }

  forceRefresh(evt: any) {
    setTimeout(() => {
      this.api.retry().finally(() => {
        evt.target.complete();
      });
    }, 500);
  }

  toggleSearchbar() {
    this.filterVisible = !this.filterVisible;
    console.debug(`Stream.toggleSearchbar(): filterVisible=${this.filterVisible}`);
  }

  filterList(evt: any) {
    this.searchTerm = evt.srcElement.value;
    return this.refreshUI();
  }

  getSegmentGames() {
    console.debug('Stream.getSegmentGames()');
    if (this.data && this.data.games && this.data.games.schedule) {
      return this.data.games.schedule.filter((game: any) => {
        switch(this.segment) {
          case 'all':
            return true;
          case 'active':
            return !game.gameComplete;
          case 'favorites':
            return this.settings.isFavorite(game.homeTeam) || this.settings.isFavorite(game.awayTeam);
          default:
            console.warn(`Stream.getSegmentGames(): unhandled segment: ${this.segment}`);
            return false;
        }
      }).sort((a: any, b: any) => {
        const nameA = a.homeTeamNickname;
        const nameB = b.homeTeamNickname;
        return (nameA < nameB) ? -1 : (nameA > nameB) ? 1 : 0;
      });
    }
    return [];
  }

  isPostseason() {
    return Boolean(this?.data?.games?.postseason?.playoffs !== undefined);
  }

  isFinished() {
    const isFinished = Boolean(this.getWinner() !== undefined);

    if (this.clockUpdater && !isFinished) {
      clearInterval(this.clockUpdater);
      this.clockUpdater = undefined;
    } else if (!this.clockUpdater && isFinished) {
      this.clockUpdater = setInterval(() => {
        const now = Date.now();
        const start = new Date(this.data.games.sim.nextSeasonStart).getTime();
        const diff = Math.floor((start - now) / 1000.0); // drop millis

        this.countdown.hours = Math.floor(diff / 60 / 60);
        let remainder = diff - (this.countdown.hours * 60 * 60);
        this.countdown.minutes = Math.floor(remainder / 60);
        this.countdown.seconds = remainder - (this.countdown.minutes * 60);
      });
    }

    return isFinished;
  }

  getWinner() {
    const winner = this?.data?.games?.postseason?.playoffs?.winner;
    if (winner) {
      return this.data.leagues.teams.find((team:any) => team.id === winner);
    }
    return undefined;
  }

  getNextSeasonStart() {
    return `${this.countdown.hours} ${this.countdown.hours === 1? 'hour':'hours'}, ${this.countdown.minutes} ${this.countdown.minutes === 1? 'minute':'minutes'}, ${this.countdown.seconds} ${this.countdown.seconds === 1? 'second':'seconds'}`;
  }

  refreshUI() {
    console.debug('Stream.refreshUI()');

    let ret = this.getSegmentGames();

    if (this.searchTerm && this.searchTerm.length >= 2) {
      // search term is long enough, filter based on team names
      ret = ret.filter((game: any) => {
        return game.homeTeamName.toLowerCase().indexOf(this.searchTerm.toLowerCase()) > -1
          || game.awayTeamName.toLowerCase().indexOf(this.searchTerm.toLowerCase()) > -1
      });
    }

    this.games = ret;
    return this.games;
  }

  segmentChanged(evt: any) {
    if (evt && evt.detail && evt.detail.value) {
      this.segment = evt.detail.value;
      this.settings.setSegment(this.segment);
    }
    console.debug('Stream.segmentChanged():', evt);
    this.refreshUI();
  }

  checkStale() {
    const current = this.stale;
    if (this.games && this.games.length > 0) {
      const active = this.games.find(game => !game.gameComplete);
      if (active) {
        // there are still active games, check staleness based on the last update received
        if (this.lastUpdate + this.staleThreshold < Date.now()) {
          this.stale = true;
        } else {
          this.stale = false;
        }
      } else {
        // all active games have completed
        this.stale = false;
        // const percent = Math.round(Date.now() % (60 * 60 * 1000) / (60 * 60 * 1000)); // how far through the hour are we?
      }
    }

    console.debug(`Stream.checkStale(): ${current} -> ${this.stale}`);
  }

  onEvent(evt: MessageEvent|Event) {
    if (evt['type'] === 'error') {
      this.onError(evt);
      return;
    }

    this.lastUpdate = Date.now();
    setTimeout(() => {
      this.errors = 0;
      this.checkStale();
    }, 1000);

    const data = JSON.parse((evt as MessageEvent).data).value;

    if (!this.data) {
      this.data = {};
    }

    for (const key of Object.keys(data)) {
      this.data[key] = data[key];
    }

    console.debug('Stream.onEvent(): current data:', this.data);
    this.refreshUI();
    this.hideLoading();
  }

  onError(evt: Event) {
    console.debug('Stream.onError():', evt);
    this.hideLoading();
    this.loading = false;
    // wait a couple of seconds before actually marking it as an error
    setTimeout(() => {
      this.errors++;
      this.checkStale();
    }, 1000);
  }

  startListening() {
    console.debug('Stream.startListening(): opening event stream to blaseball.com');
    this.showLoading();

    const errorWait = 1000;

    const onError = (err: Event) => {
    };

    const observable = this.api.start();
    this.subscription = observable.subscribe((evt) => {
      this.onEvent(evt);
    }, (err) => {
      this.onError(err);
    });
  }

  gameId(index: number, item:any): string {
    if (item && item.id) {
      return item.id;
    }
    return String(index);
  }
}
