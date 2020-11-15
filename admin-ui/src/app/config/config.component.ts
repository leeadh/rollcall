import { CheckProxy } from './../service/check-proxy.service';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-config',
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit {
  isAlive: boolean;
  checkResult: {};

  constructor(private CheckProxy: CheckProxy) { }

 ngOnInit(): void {

  this.CheckProxy.checkProxy().subscribe(headers => {
    this.checkResult = headers;
    console.log(this.checkResult);
    if (this.checkResult) {
      this.isAlive = true;
    }
  });
  }
}