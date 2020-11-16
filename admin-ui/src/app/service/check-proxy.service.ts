import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import env from 'config/env.json';

console.log(env);


@Injectable({
  providedIn: 'root'
})

export class CheckProxy {
  constructor(private httpclient: HttpClient) { }
  headers = new HttpHeaders()
  .set('Authorization', 'Bearer' + env.local.bearer)
  .set('Access-Control-Allow-Origin', '*');
public checkProxy(): Observable<Response[]> {
// tslint:disable-next-line: max-line-length
return this.httpclient.get<Response[]>('/access/Users?attributes=userName&filter=userName%20eq%20%22adminsdsdsdsds%22', { headers: this.headers }).pipe(map((headers: any) => headers));
}
}
