import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { GearItem } from '../shared/models/item';

@Injectable({
  providedIn: 'root',
})
export class GearData {
  private dataUrl = '/items.json';

  constructor(private http: HttpClient) {}

  getAvailableItems(): Observable<GearItem[]> {
    return this.http.get<GearItem[]>(this.dataUrl).pipe(
      catchError((error) => {
        console.error('FAILED TO LOAD ITEMS.JSON:', error);
        return of([]);
      }),
    );
  }

  getImageUrl(itemId: string): string {
    return `https://render.albiononline.com/v1/item/${itemId}.png?quality=4`;
  }
}
