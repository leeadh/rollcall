import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';



@Injectable({
  providedIn: 'root'
})

export class CheckProxy {
  constructor(private httpclient: HttpClient) { }
  path = '/access/Users';
  public checkProxy(): Observable<Response[]> {
    return this.httpclient.get<Response[]>('/access/Users').pipe(map((headers: any) => headers));
  }
}
