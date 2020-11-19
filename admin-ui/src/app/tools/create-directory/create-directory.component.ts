import { HttpErrorResponse, HttpHeaderResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { ClrLoadingState } from '@clr/angular';
import { CreateDomain } from '../../create-domain.model';
import { DomainsService } from '../../service/domains.service';

@Component({
  selector: 'app-create-directory',
  templateUrl: './create-directory.component.html',
  styleUrls: ['./create-directory.component.scss']
})
export class CreateDirectoryComponent implements OnInit {

  Domains
  ResponseBody
  constructor(private domainsService: DomainsService) { }
  isWorking:boolean

  ngOnInit(): void {

    this.domainsService.getDomains()
    .subscribe(
      body => { this.Domains = body; },
      error => { console.log('error', error), this.isWorking = false;}
      )      
  }
  
  
  createBtnState: ClrLoadingState = ClrLoadingState.DEFAULT;
  newDomain = new CreateDomain ('', '')
  postbody = {}
  isError:boolean
  isSuccess:boolean
 
  onClick() {
        this.postbody = {
    
        "domains": this.newDomain.domain_name,
        "name": this.newDomain.friendly_name
        
    };
    this.createBtnState = ClrLoadingState.LOADING;
   
    
    this.domainsService.createDirectory(this.postbody)
    .subscribe(
      data => { console.log('success', data), this.isSuccess = true, this.createBtnState = ClrLoadingState.SUCCESS;},
      error => { console.log('error', error), this.isError= true, this.createBtnState = ClrLoadingState.ERROR;}
    )
   }

  hideError() {

    this.isError = false;

  }
  hidesuccess() {

    this.isSuccess = false;

  }
}
