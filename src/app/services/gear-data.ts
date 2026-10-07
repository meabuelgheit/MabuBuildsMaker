import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { GearItem } from '../shared/models/item';

@Injectable({
  providedIn: 'root',
})
export class GearData {
  private dataUrl = 'items.json';

  /** Lazily-created, shared catalog fetch so items.json loads only once. */
  private items$: Observable<GearItem[]> | null = null;

  constructor(private http: HttpClient) {}

  /** Returns a shareReplay-backed catalog observable (fetched at most once). */
  getAvailableItems(): Observable<GearItem[]> {
    if (!this.items$) {
      this.items$ = this.http.get<GearItem[]>(this.dataUrl).pipe(
        catchError((error) => {
          console.error('FAILED TO LOAD ITEMS.JSON:', error);
          return of([]);
        }),
        shareReplay(1),
      );
    }
    return this.items$;
  }

  /** Builds a render-service icon URL at the requested pixel size. */
  getImageUrl(itemId: string, size: 64 | 128 | 217 = 128): string {
    return `https://render.albiononline.com/v1/item/${itemId}.png?quality=4&size=${size}`;
  }
}
