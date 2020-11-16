import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import env from 'config/env.json';


@Injectable({
  providedIn: 'root'
})

export class DomainsService {
createError;
createSuccess;
isError: boolean;
isSuccess: boolean;

constructor(private httpClient: HttpClient) { }
headers = new HttpHeaders()
  .set('Authorization', 'Bearer ' + env.local.bearer)
  .set('Access-Control-Allow-Origin', '*');
options = {
    observe: 'response' as 'body',
    headers: this.headers
  };

public getDomains(): Observable<any[]> {
  return this.httpClient.get<any[]>('access/connectormanagement/directoryconfigs', { headers: this.headers });
}

public createDirectory(postbody): Observable<any[]> {
return this.httpClient.post<any[]>('access/connectormanagement/directoryconfigs', postbody, this.options);
}
}
