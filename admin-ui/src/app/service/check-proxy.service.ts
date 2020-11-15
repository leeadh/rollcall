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
  .set('Authorization', 'Bearer 123456789')
  .set('Access-Control-Allow-Origin', '*');
public checkProxy(): Observable<Response[]> {
return this.httpclient.get<Response[]>('http://localhost:8888/access/Users?attributes=userName&filter=userName%20eq%20%22adminsdsdsdsds%22', { 'headers': this.headers }).pipe(map((headers: any) => headers));
}
}