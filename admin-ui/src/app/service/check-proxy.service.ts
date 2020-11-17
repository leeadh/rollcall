import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';



@Injectable({
  providedIn: 'root'
})

export class CheckProxy {
  constructor(private httpclient: HttpClient) { }
  headers = new HttpHeaders()
 // .set('Authorization', 'Bearer' + env.local.bearer)   <--Needs fixing before re-introducing to prod
  .set('Access-Control-Allow-Origin', '*');
public checkProxy(): Observable<Response[]> {
// tslint:disable-next-line: max-line-length
console.log(this.headers);
return this.httpclient.get<Response[]>('/access/Users?attributes=userName&filter=userName%20eq%20%22adminsdsdsdsds%22', { headers: this.headers }).pipe(map((headers: any) => headers));
}
}
